package com.runway.backend.domain.auth.service;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;

@Component
public class RefreshTokenFactory {
    private final SecureRandom random = new SecureRandom();

    public IssuedRefreshToken rotate(long userId, String family, Instant created, Instant expires) {
        String value = family + "." + random(32);
        return new IssuedRefreshToken(userId, family, value, hash(value), created, expires);
    }

    public static PresentedToken parse(String value) {
        if (value == null || !value.matches("[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}")) return null;
        return new PresentedToken(value.substring(0, 22), hash(value));
    }

    private static String hash(String value) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("인증수단을 생성할 수 없습니다.");
        }
    }

    public record PresentedToken(String familyId, String hash) {
        @Override
        public String toString() {
            return "PresentedToken[REDACTED]";
        }
    }

    public IssuedRefreshToken create(long userId, Instant now) {
        String family = random(16);
        String value = family + "." + random(32);
        Instant created = now.truncatedTo(ChronoUnit.SECONDS);
        try {
            String hash =
                    HexFormat.of()
                            .formatHex(
                                    MessageDigest.getInstance("SHA-256")
                                            .digest(value.getBytes(StandardCharsets.UTF_8)));
            return new IssuedRefreshToken(
                    userId, family, value, hash, created, created.plusSeconds(2592000));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("인증수단을 생성할 수 없습니다.");
        }
    }

    private String random(int length) {
        byte[] bytes = new byte[length];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public record IssuedRefreshToken(
            long userId,
            String familyId,
            String value,
            String hash,
            Instant createdAt,
            Instant expiresAt) {
        @Override
        public String toString() {
            return "IssuedRefreshToken[REDACTED]";
        }
    }
}
