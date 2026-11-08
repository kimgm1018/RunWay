package com.runway.backend.domain.user.service;

import com.runway.backend.domain.community.repository.AccountVisibilityRepository;
import com.runway.backend.domain.image.ImageService;
import com.runway.backend.domain.user.repository.FollowRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** U26 팔로워 목록 · U27 팔로잉 목록 (users.md, S15P31E105-534). */
@Service
@RequiredArgsConstructor
public class FollowListService {
    static final int PAGE_SIZE = 20;
    private static final Instant MIN_TIME = Instant.parse("0001-01-01T00:00:00Z");
    private static final Instant MAX_TIME = Instant.parse("9999-12-31T23:59:59.999999Z");

    private final FollowRepository follows;
    private final AccountVisibilityRepository visibility;

    public enum Kind {
        FOLLOWERS,
        FOLLOWING
    }

    public record Item(long userId, String nickname, String profileImageUrl) {}

    public record Page(List<Item> items, String nextCursor, boolean hasNext) {}

    private record Cursor(Instant before, long beforeId) {}

    // The access decision and the rows share one snapshot, as U21 does, so a follow cancelled
    // mid-read never yields a list to a viewer who was just refused.
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page list(long viewer, long target, Kind kind, String cursor, Integer limit) {
        if (target <= 0) throw new ApiException(ErrorCode.VALIDATION_ERROR);
        if (limit != null && limit != PAGE_SIZE)
            throw new ApiException(ErrorCode.FOLLOW_LIST_INVALID_FILTER);
        if (!follows.isActive(viewer)) throw new ApiException(ErrorCode.UNAUTHORIZED);
        if (!follows.isActive(target)) throw new ApiException(ErrorCode.FOLLOW_USER_NOT_FOUND);
        // Checked before the cursor, so a hidden list cannot be probed through cursor errors.
        if (!visibility.canAccess(viewer, target))
            throw new ApiException(ErrorCode.FOLLOW_LIST_ACCESS_DENIED);
        Cursor after = cursor == null ? null : decode(cursor, target, kind);
        var rows = follows.approved(target, kind == Kind.FOLLOWERS,
                after == null ? null : after.before(), after == null ? 0 : after.beforeId(),
                PAGE_SIZE + 1);
        boolean more = rows.size() > PAGE_SIZE;
        var page = rows.subList(0, Math.min(rows.size(), PAGE_SIZE));
        String next = null;
        if (more) {
            var last = page.getLast();
            next = Base64.getUrlEncoder().withoutPadding().encodeToString(
                    (target + "|" + kind + "|" + last.followedAt() + "|" + last.relationId())
                            .getBytes(StandardCharsets.UTF_8));
        }
        var items = page.stream()
                .map(row -> new Item(row.userId(), row.nickname(),
                        ImageService.publicUrlFromKey(row.profileImageKey())))
                .toList();
        return new Page(items, next, more);
    }

    private static Cursor decode(String cursor, long target, Kind kind) {
        try {
            if (cursor.length() > 256) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(cursor),
                    StandardCharsets.UTF_8).split("\\|", -1);
            if (parts.length != 4 || Long.parseLong(parts[0]) != target
                    || !parts[1].equals(kind.name()))
                throw new IllegalArgumentException();
            Instant before = Instant.parse(parts[2]);
            if (before.isBefore(MIN_TIME) || before.isAfter(MAX_TIME))
                throw new IllegalArgumentException();
            long beforeId = Long.parseLong(parts[3]);
            if (beforeId <= 0) throw new IllegalArgumentException();
            return new Cursor(before, beforeId);
        } catch (RuntimeException ex) {
            throw new ApiException(ErrorCode.FOLLOW_LIST_INVALID_FILTER);
        }
    }
}
