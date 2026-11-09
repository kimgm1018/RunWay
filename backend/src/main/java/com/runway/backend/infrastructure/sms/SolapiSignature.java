package com.runway.backend.infrastructure.sms;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * SOLAPI API Key 인증 헤더(공식 Node SDK {@code src/lib/authenticator.ts}와 같은 방식, 2026-11-09 확인).
 *
 * <p>{@code HMAC-SHA256 apiKey=<key>, date=<ISO 8601>, salt=<32자>, signature=<hex(HMAC-SHA256(secret, date + salt))>}
 */
final class SolapiSignature {
    private static final String ALPHABET =
            "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    static final int SALT_LENGTH = 32;

    private SolapiSignature() {}

    static String authorization(String apiKey, String apiSecret, String date, String salt) {
        return "HMAC-SHA256 apiKey=" + apiKey + ", date=" + date + ", salt=" + salt
                + ", signature=" + signature(apiSecret, date, salt);
    }

    static String signature(String apiSecret, String date, String salt) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(apiSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal((date + salt).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256을 사용할 수 없습니다.");
        }
    }

    /** 초 단위 ISO 8601(오프셋 포함). */
    static String date(Clock clock) {
        return OffsetDateTime.now(clock)
                .truncatedTo(ChronoUnit.SECONDS)
                .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    /** 영문 대소문자·숫자 32자. 편향 없는 {@link SecureRandom#nextInt(int)}을 쓴다. */
    static String salt(SecureRandom random) {
        var builder = new StringBuilder(SALT_LENGTH);
        for (int i = 0; i < SALT_LENGTH; i++) {
            builder.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return builder.toString();
    }
}
