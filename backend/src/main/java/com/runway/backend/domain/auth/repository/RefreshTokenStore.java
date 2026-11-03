package com.runway.backend.domain.auth.repository;

import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.PresentedToken;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public class RefreshTokenStore {
    private final StringRedisTemplate redis;
    private final DefaultRedisScript<Long> create = script("create-login-family.lua");
    private final DefaultRedisScript<Long> revoke = script("revoke-undelivered-family.lua");
    private final DefaultRedisScript<Long> rotate = script("rotate-refresh-token.lua");
    private final DefaultRedisScript<Long> logout = script("logout-family.lua");

    public RefreshTokenStore(@Qualifier("authenticationRedisTemplate") StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void create(IssuedRefreshToken token) {
        create(token, List.of(familyKey(token.familyId()), userKey(token.userId())));
    }

    public void createForLogin(IssuedRefreshToken token, String loginId) {
        create(
                token,
                List.of(
                        familyKey(token.familyId()),
                        userKey(token.userId()),
                        LoginAttemptStore.key(loginId)));
    }

    /**
     * This is only a candidate read. The atomic mutation rechecks every authorization condition.
     */
    public Family find(PresentedToken token) {
        try {
            String key = familyKey(token.familyId());
            List<Object> fields =
                    redis.opsForHash()
                            .multiGet(
                                    key,
                                    List.of(
                                            "schemaVersion",
                                            "userId",
                                            "createdAt",
                                            "expiresAt",
                                            "state",
                                            "currentTokenHash",
                                            "used:" + token.hash()));
            Long ttl = redis.getExpire(key);
            if (!"1".equals(fields.get(0))
                    || !"ACTIVE".equals(fields.get(4))
                    || ttl == null
                    || ttl <= 0
                    || fields.subList(0, 6).contains(null)
                    || (!token.hash().equals(fields.get(5)) && !"1".equals(fields.get(6))))
                throw new ApiException(ErrorCode.INVALID_REFRESH_TOKEN);
            long user = Long.parseLong((String) fields.get(1));
            Instant created = Instant.ofEpochSecond(Long.parseLong((String) fields.get(2)));
            Instant expires = Instant.ofEpochSecond(Long.parseLong((String) fields.get(3)));
            if (user <= 0
                    || !expires.isAfter(created)
                    || expires.getEpochSecond() - created.getEpochSecond() > 2592000)
                throw new ApiException(ErrorCode.INVALID_REFRESH_TOKEN);
            return new Family(user, created, expires);
        } catch (ApiException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
    }

    public void rotate(PresentedToken previous, IssuedRefreshToken next, Instant now) {
        Long result;
        try {
            result =
                    redis.execute(
                            rotate,
                            List.of(familyKey(previous.familyId())),
                            previous.hash(),
                            next.hash(),
                            Long.toString(next.userId()),
                            Long.toString(next.createdAt().getEpochSecond()),
                            Long.toString(next.expiresAt().getEpochSecond()),
                            Long.toString(now.toEpochMilli()));
        } catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        if (Long.valueOf(0).equals(result)) throw new ApiException(ErrorCode.INVALID_REFRESH_TOKEN);
        if (!Long.valueOf(1).equals(result)) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
    }

    /** Also used to compensate an uncertain rotation, including when the old token is now used. */
    public void logout(PresentedToken token) {
        try {
            Long result = redis.execute(logout, List.of(familyKey(token.familyId())), token.hash());
            if (!Long.valueOf(1).equals(result))
                throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        } catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
    }

    public record Family(long userId, Instant createdAt, Instant expiresAt) {}

    // 로그인할 때 토큰 정보를 레디스에 저장
    private void create(IssuedRefreshToken token, List<String> keys) {
        Long result;
        try {
            result =
                    redis.execute(
                            create,
                            keys,
                            token.familyId(),
                            Long.toString(token.userId()),
                            token.hash(),
                            Long.toString(token.createdAt().getEpochSecond()),
                            Long.toString(token.expiresAt().getEpochSecond()));
        } catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        if (Long.valueOf(5).equals(result)) throw new ApiException(ErrorCode.LOGIN_LOCKED);
        if (!Long.valueOf(1).equals(result)) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
    }

    /** Best effort compensation: no token material or driver exception enters logs. */
    public boolean revokeUndelivered(IssuedRefreshToken token) {
        try {
            return Long.valueOf(1)
                    .equals(
                            redis.execute(
                                    revoke,
                                    List.of(familyKey(token.familyId())),
                                    Long.toString(token.userId()),
                                    token.hash()));
        } catch (RuntimeException exception) {
            return false;
        }
    }

    public static String familyKey(String family) {
        return "runway:auth:family:" + family;
    }

    public static String userKey(long user) {
        return "runway:auth:user:" + user + ":families";
    }

    private static DefaultRedisScript<Long> script(String name) {
        var result = new DefaultRedisScript<Long>();
        result.setLocation(new ClassPathResource("auth/" + name));
        result.setResultType(Long.class);
        return result;
    }
}
