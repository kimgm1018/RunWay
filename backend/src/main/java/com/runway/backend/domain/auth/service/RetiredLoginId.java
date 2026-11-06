package com.runway.backend.domain.auth.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** Reservation digest for a retired login ID; never an authentication credential. */
public final class RetiredLoginId {
    private RetiredLoginId() {}

    public static String digest(String loginId) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(loginId.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("탈퇴 식별자를 생성할 수 없습니다.");
        }
    }
}
