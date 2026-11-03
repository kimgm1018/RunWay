package com.runway.backend.domain.auth.repository;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class LoginAttemptStore {
    private final StringRedisTemplate redis;
    private final DefaultRedisScript<Long> script;

    public LoginAttemptStore(@Qualifier("authenticationRedisTemplate") StringRedisTemplate redis) {
        this.redis = redis;
        script = new DefaultRedisScript<>();
        script.setLocation(new ClassPathResource("auth/login-attempt.lua"));
        script.setResultType(Long.class);
    }

    // 실패횟수 확인(5회 실패 시 잠금)
    public void ensureAllowed(String loginId) {
        if (execute(loginId, "check") == 5) throw new ApiException(ErrorCode.LOGIN_LOCKED);
    }
    ;

    /** Redis writes survive the caller's PostgreSQL transaction rollback. */
    public int recordFailure(String loginId) {
        return execute(loginId, "fail");
    }

    private int execute(String loginId, String operation) {
        Long result;
        try {
            result = redis.execute(script, List.of(key(loginId)), operation);
        } catch (RuntimeException exception) {
            // Do not expose driver messages, key names or uncertain writes; never replay here.
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        if (result == null || result < 0 || result > 5)
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        return result.intValue();
    }

    public static String key(String loginId) {
        if (loginId == null || !loginId.matches("[A-Za-z0-9]{4,16}"))
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        return "runway:auth:attempt:" + loginId;
    }
}
