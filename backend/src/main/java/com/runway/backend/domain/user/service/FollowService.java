package com.runway.backend.domain.user.service;

import com.runway.backend.domain.user.repository.FollowRepository;
import com.runway.backend.domain.user.repository.PrivacySettingsRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class FollowService {
    private final FollowRepository follows;
    private final PrivacySettingsRepository privacy;
    private final ApplicationEventPublisher events;

    public record Result(long followerCount, String followStatus, boolean following) {}
    public record Decision(long requesterId, String followStatus) {}
    public record Page(List<FollowRepository.Request> items, String nextCursor, boolean hasNext) {}

    @Transactional
    public Result follow(long actor, long target) {
        if (actor == target) throw new ApiException(ErrorCode.CANNOT_FOLLOW_SELF);
        boolean isPrivate = lock(actor, target);
        var current = follows.find(actor, target);
        if (current.isPresent()) return result(target, current.get().approved());
        var created = follows.create(actor, target, !isPrivate);
        events.publishEvent(new FollowNotificationEvent(created.id(), actor, target,
                isPrivate ? FollowNotificationEvent.Kind.FOLLOW_REQUEST
                        : FollowNotificationEvent.Kind.NEW_FOLLOWER));
        return result(target, created.approved());
    }

    @Transactional
    public Result cancel(long actor, long target) {
        lock(actor, target);
        follows.find(actor, target).ifPresent(row -> {
            follows.remember(row.id(), actor, target, "CANCELLED");
            follows.delete(row.id());
        });
        return new Result(follows.followerCount(target), "NONE", false);
    }

    @Transactional
    public Decision decide(long owner, long requester, long requestId, String decision) {
        if (requestId <= 0 || requester <= 0 || decision == null)
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        if (!decision.equals("APPROVE") && !decision.equals("REJECT"))
            throw new ApiException(ErrorCode.FOLLOW_INVALID_DECISION);
        lock(owner, owner);
        var current = follows.find(requester, owner);
        var history = follows.history(requestId);
        String expected = decision.equals("APPROVE") ? "APPROVED" : "REJECTED";
        if (history.isPresent()) {
            var old = history.get();
            if (old.requesterId() != requester || old.targetId() != owner)
                throw new ApiException(ErrorCode.REQUEST_NOT_FOUND);
            if (!old.result().equals(expected)
                    || (current.isPresent() && current.get().id() != requestId))
                throw new ApiException(ErrorCode.REQUEST_STATE_CONFLICT);
            return new Decision(requester, decision.equals("APPROVE") ? "FOLLOWING" : "NONE");
        }
        if (current.isEmpty()) throw new ApiException(ErrorCode.REQUEST_NOT_FOUND);
        var row = current.get();
        if (row.id() != requestId || row.approved())
            throw new ApiException(ErrorCode.REQUEST_STATE_CONFLICT);
        if (!follows.isActive(requester)) throw new ApiException(ErrorCode.REQUEST_NOT_FOUND);
        follows.remember(row.id(), requester, owner, expected);
        if (decision.equals("APPROVE")) {
            follows.approve(row.id());
            events.publishEvent(new FollowNotificationEvent(row.id(), owner, requester,
                    FollowNotificationEvent.Kind.FOLLOW_APPROVED));
        } else {
            follows.delete(row.id());
        }
        return new Decision(requester, decision.equals("APPROVE") ? "FOLLOWING" : "NONE");
    }

    @Transactional(readOnly = true)
    public Page pending(long owner, String cursor, Integer limit) {
        requireActor(owner);
        if (limit != null && limit != 10) throw new ApiException(ErrorCode.FOLLOW_INVALID_FILTER);
        Instant before = null;
        long beforeId = 0;
        if (cursor != null) {
            try {
                if (cursor.length() > 256) throw new IllegalArgumentException();
                String[] parts = new String(Base64.getUrlDecoder().decode(cursor),
                        StandardCharsets.UTF_8).split("\\|", -1);
                if (parts.length != 3 || Long.parseLong(parts[0]) != owner)
                    throw new IllegalArgumentException();
                before = Instant.parse(parts[1]);
                if (before.isBefore(Instant.parse("0001-01-01T00:00:00Z"))
                        || before.isAfter(Instant.parse("9999-12-31T23:59:59.999999Z")))
                    throw new IllegalArgumentException();
                beforeId = Long.parseLong(parts[2]);
                if (beforeId <= 0) throw new IllegalArgumentException();
            } catch (RuntimeException ex) {
                throw new ApiException(ErrorCode.FOLLOW_INVALID_FILTER);
            }
        }
        var rows = follows.pending(owner, before, beforeId);
        boolean more = rows.size() > 10;
        var items = List.copyOf(rows.subList(0, Math.min(rows.size(), 10)));
        String next = null;
        if (more) {
            var last = items.getLast();
            next = Base64.getUrlEncoder().withoutPadding().encodeToString(
                    (owner + "|" + last.requestedAt() + "|" + last.requestId())
                            .getBytes(StandardCharsets.UTF_8));
        }
        return new Page(items, next, more);
    }

    private boolean lock(long actor, long target) {
        if (target <= 0) throw new ApiException(ErrorCode.VALIDATION_ERROR);
        if (!follows.lockTarget(target)) throw new ApiException(ErrorCode.FOLLOW_USER_NOT_FOUND);
        requireActor(actor);
        return privacy.lock(target).orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE))
                .isPrivate();
    }

    private void requireActor(long actor) {
        if (!follows.isActive(actor)) throw new ApiException(ErrorCode.UNAUTHORIZED);
    }

    private Result result(long target, boolean approved) {
        return new Result(follows.followerCount(target), approved ? "FOLLOWING" : "PENDING", approved);
    }
}
