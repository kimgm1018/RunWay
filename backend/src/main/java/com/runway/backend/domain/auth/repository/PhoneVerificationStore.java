package com.runway.backend.domain.auth.repository;

import com.runway.backend.domain.auth.verification.PhoneVerificationPurpose;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 휴대전화 인증 상태(users.md U28~U30, S15P31E105-560). 기존 인증용 Redis에 Lua로 원자적으로 저장한다.
 *
 * <p>전화번호·IP는 SHA-256 해시로만 키에 쓰고, 인증번호·증명은 해시만 저장한다. 증명 값에는 재설정 대상을 찾기 위해 목적과
 * 전화번호를 10분 동안 둔다. 키는 앱 ACL 범위 {@code runway:auth:*} 안이며 허용 명령만 쓴다. 저장소 오류는 503이며 다시
 * 실행하지 않는다.
 */
@Repository
public class PhoneVerificationStore {
    private static final String PREFIX = "runway:auth:phone:";

    private final StringRedisTemplate redis;
    @SuppressWarnings("rawtypes")
    private final DefaultRedisScript<List> issue;
    @SuppressWarnings("rawtypes")
    private final DefaultRedisScript<List> confirm;
    private final DefaultRedisScript<Long> discard;
    private final DefaultRedisScript<String> consume;

    public PhoneVerificationStore(@Qualifier("authenticationRedisTemplate") StringRedisTemplate redis) {
        this.redis = redis;
        issue = script("auth/phone-code-issue.lua", List.class);
        confirm = script("auth/phone-code-confirm.lua", List.class);
        discard = script("auth/phone-code-discard.lua", Long.class);
        consume = script("auth/phone-proof-consume.lua", String.class);
    }

    /** 결과 종류와 값(남은 초·실패 횟수 등). */
    public record Outcome(int status, long value) {}

    /** 증명에 묶인 목적과 전화번호. 로그에 남기지 않는다. */
    public record Proof(PhoneVerificationPurpose purpose, String phoneNumber) {
        @Override
        public String toString() {
            return "Proof[REDACTED]";
        }
    }

    /** {@code status}: 1 저장, -2 재발송 대기, -3 24시간 한도. */
    public Outcome issue(PhoneVerificationPurpose purpose, String phone, String ip, String code) {
        String phoneHash = sha256(phone);
        return run(issue,
                List.of(codeKey(purpose, phoneHash), PREFIX + "wait:" + purpose + ":" + phoneHash,
                        PREFIX + "sent:" + phoneHash, PREFIX + "ip:" + sha256(ip)),
                codeHash(phoneHash, code), UUID.randomUUID().toString());
    }

    /** 공급자가 명확히 거절한 인증번호를 지운다. 그 사이 새 인증번호로 바뀌었으면 그대로 둔다. */
    public void discard(PhoneVerificationPurpose purpose, String phone, String code) {
        String phoneHash = sha256(phone);
        try {
            redis.execute(discard, List.of(codeKey(purpose, phoneHash)), codeHash(phoneHash, code));
        } catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
    }

    /** {@code status}: 1 증명 저장, -1 유효한 인증번호 없음, -5 불일치(value=실패 횟수), -4 5회째 불일치. */
    public Outcome confirm(PhoneVerificationPurpose purpose, String phone, String code, String token) {
        String phoneHash = sha256(phone);
        return run(confirm, List.of(codeKey(purpose, phoneHash), proofKey(token)),
                codeHash(phoneHash, code), purpose.name() + ":" + phone);
    }

    /** 증명을 한 번만 꺼낸다. 없거나 만료·사용됐으면 비어 있다. */
    public Optional<Proof> consume(String token) {
        String value;
        try {
            value = redis.execute(consume, List.of(proofKey(token)));
        } catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        if (value == null) return Optional.empty();
        int separator = value.indexOf(':');
        var purpose = PhoneVerificationPurpose.parse(separator < 0 ? null : value.substring(0, separator));
        String phone = separator < 0 ? "" : value.substring(separator + 1);
        if (purpose.isEmpty() || !phone.matches("010[0-9]{8}"))
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        return Optional.of(new Proof(purpose.get(), phone));
    }

    @SuppressWarnings("rawtypes")
    private Outcome run(DefaultRedisScript<List> script, List<String> keys, String... args) {
        List<?> result;
        try {
            result = redis.execute(script, keys, (Object[]) args);
        } catch (RuntimeException exception) {
            // 드라이버 메시지·키를 노출하지 않고, 결과가 불명확한 쓰기를 다시 실행하지 않는다.
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        if (result == null || result.size() != 2
                || !(result.get(0) instanceof Long status) || !(result.get(1) instanceof Long value))
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        return new Outcome(status.intValue(), value);
    }

    private static <T> DefaultRedisScript<T> script(String location, Class<T> type) {
        var script = new DefaultRedisScript<T>();
        script.setLocation(new ClassPathResource(location));
        script.setResultType(type);
        return script;
    }

    /** 테스트·운영 점검용. 전화번호 원문은 키에 들어가지 않는다. */
    public static String codeKeyFor(PhoneVerificationPurpose purpose, String phone) {
        return codeKey(purpose, sha256(phone));
    }

    private static String codeKey(PhoneVerificationPurpose purpose, String phoneHash) {
        return PREFIX + "code:" + purpose + ":" + phoneHash;
    }

    public static String proofKey(String token) {
        return PREFIX + "proof:" + sha256(token);
    }

    private static String codeHash(String phoneHash, String code) {
        return sha256(phoneHash + ":" + code);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("인증 상태를 처리할 수 없습니다.");
        }
    }
}
