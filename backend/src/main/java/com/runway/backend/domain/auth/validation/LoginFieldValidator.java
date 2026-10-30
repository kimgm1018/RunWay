package com.runway.backend.domain.auth.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public final class LoginFieldValidator implements ConstraintValidator<LoginField, Object> {
    private LoginField.Kind kind;

    @Override
    public void initialize(LoginField constraint) {
        kind = constraint.value();
    }

    @Override
    public boolean isValid(Object value, ConstraintValidatorContext context) {
        return kind == LoginField.Kind.PASSWORD
                ? PasswordPolicy.accepts(value)
                : value instanceof String text && text.matches("[A-Za-z0-9]{4,16}");
    }
}
