package com.runway.backend.domain.auth.verification;

import java.util.Optional;

/** 휴대전화 인증 목적(users.md U28). 인증번호·증명은 목적에 묶이며 다른 목적에 쓸 수 없다. */
public enum PhoneVerificationPurpose {
    SIGN_UP,
    PASSWORD_RESET;

    public static Optional<PhoneVerificationPurpose> parse(Object value) {
        if (!(value instanceof String text)) return Optional.empty();
        for (var purpose : values()) {
            if (purpose.name().equals(text)) return Optional.of(purpose);
        }
        return Optional.empty();
    }
}
