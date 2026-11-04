package com.runway.backend.domain.auth.service;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Component
public class LoginIdAvailabilityLimiter {
    private final StringRedisTemplate redis;
    private final DefaultRedisScript<Long> script;

    public LoginIdAvailabilityLimiter(
            @Qualifier("authenticationRedisTemplate") StringRedisTemplate redis) {
        this.redis = redis;
        script = new DefaultRedisScript<>();
        script.setLocation(new ClassPathResource("auth/login-id-availability-limit.lua"));
        script.setResultType(Long.class);
    }

    public void check(String ip) {
        Long allowed;
        try {
            allowed = redis.execute(script, List.of(key(ip)), UUID.randomUUID().toString());
        } catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        if (Long.valueOf(0).equals(allowed)) throw new ApiException(ErrorCode.TOO_MANY_REQUESTS);
        if (!Long.valueOf(1).equals(allowed)) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
    }

    public static String key(String ip) {
        try {
            return "runway:auth:availability:"
                    + HexFormat.of()
                            .formatHex(
                                    MessageDigest.getInstance("SHA-256")
                                            .digest(ip.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("요청 제한을 처리할 수 없습니다.");
        }
    }
}
