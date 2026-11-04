package com.runway.backend.domain.auth.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class RefreshTokenFieldValidator
        implements ConstraintValidator<RefreshTokenField, Object> {
    @Override
    public boolean isValid(Object value, ConstraintValidatorContext context) {
        return value instanceof String text
                && !text.isEmpty()
                && !text.codePoints()
                        .allMatch(c -> Character.isWhitespace(c) || Character.isSpaceChar(c));
    }
}
