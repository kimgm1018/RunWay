package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.repository.PostPageQueryRepository.Activity;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;

/**
 * CMT02·CMT18·CMT19의 limit 검증과 불투명 커서(Base64URL). 알림(N01)·팔로우 목록(U26)과 같이 조회자와 조회 조건을 커서에 넣어, 다른 회원이나
 * 다른 조건(scope·authorId·목록 종류)의 커서를 그대로 쓰면 {@code 400 INVALID_FILTER}로 거절한다.
 */
final class PostPageCursor {

    static final int DEFAULT_LIMIT = 20;
    static final int MAX_LIMIT = 50;

    private static final int MAX_CURSOR_LENGTH = 256;
    private static final String FEED = "F";
    private static final Instant MIN_TIME = Instant.parse("0001-01-01T00:00:00Z");
    private static final Instant MAX_TIME = Instant.parse("9999-12-31T23:59:59.999999Z");

    record ActivityCursor(Instant createdAt, long id) {}

    private PostPageCursor() {}

    static int resolveLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new ApiException(
                    ErrorCode.INVALID_FILTER_GROUPRUN_RESOLVE_LIMIT, String.valueOf(MAX_LIMIT));
        }
        return limit;
    }

    /** CMT02 커서. 마지막 게시물 ID 다음부터(id 내림차순) 이어 조회한다. */
    static String encodeFeed(long viewerId, String scope, Long authorId, long lastPostId) {
        return encode(
                FEED + "|" + viewerId + "|" + scope + "|" + authorToken(authorId) + "|" + lastPostId);
    }

    static long decodeFeed(String cursor, long viewerId, String scope, Long authorId) {
        try {
            String[] parts = decode(cursor, 5);
            if (!FEED.equals(parts[0])
                    || Long.parseLong(parts[1]) != viewerId
                    || !scope.equals(parts[2])
                    || !authorToken(authorId).equals(parts[3])) {
                throw new IllegalArgumentException();
            }
            return positiveId(parts[4]);
        } catch (RuntimeException ex) {
            throw invalidCursor();
        }
    }

    /** CMT18·CMT19 커서. 마지막 관계 행의 (생성 시각, ID) 다음부터 이어 조회한다. */
    static String encodeActivity(long userId, Activity activity, Instant createdAt, long id) {
        return encode(activity.name() + "|" + userId + "|" + createdAt + "|" + id);
    }

    static ActivityCursor decodeActivity(String cursor, long userId, Activity activity) {
        try {
            String[] parts = decode(cursor, 4);
            if (!activity.name().equals(parts[0]) || Long.parseLong(parts[1]) != userId) {
                throw new IllegalArgumentException();
            }
            Instant createdAt = Instant.parse(parts[2]);
            if (createdAt.isBefore(MIN_TIME) || createdAt.isAfter(MAX_TIME)) {
                throw new IllegalArgumentException();
            }
            return new ActivityCursor(createdAt, positiveId(parts[3]));
        } catch (RuntimeException ex) {
            throw invalidCursor();
        }
    }

    private static String authorToken(Long authorId) {
        return authorId == null ? "" : authorId.toString();
    }

    private static long positiveId(String token) {
        long id = Long.parseLong(token);
        if (id <= 0) {
            throw new IllegalArgumentException();
        }
        return id;
    }

    private static String encode(String raw) {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private static String[] decode(String cursor, int expectedParts) {
        if (cursor.length() > MAX_CURSOR_LENGTH) {
            throw new IllegalArgumentException();
        }
        String[] parts =
                new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                        .split("\\|", -1);
        if (parts.length != expectedParts) {
            throw new IllegalArgumentException();
        }
        return parts;
    }

    private static ApiException invalidCursor() {
        return new ApiException(ErrorCode.INVALID_FILTER_GROUPRUN_INVALID_CURSOR);
    }
}
