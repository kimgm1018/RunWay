package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.LoginIdAvailabilityResponse;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.validation.SignupValidator;

import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

@Service
public class LoginIdAvailabilityService {
    private final SignupRepository users;
    private final LoginIdAvailabilityLimiter limiter;

    public LoginIdAvailabilityService(SignupRepository users, LoginIdAvailabilityLimiter limiter) {
        this.users = users;
        this.limiter = limiter;
    }

    public LoginIdAvailabilityResponse check(String clientIp, String[] values) {
        limiter.check(clientIp);
        if (values == null || values.length != 1) throw SignupValidator.invalid("VALIDATION_ERROR");
        String id = values[0];
        SignupValidator.validateLoginId(id);
        try {
            boolean exists = users.loginIdExists(id);
            return new LoginIdAvailabilityResponse(id, !exists, exists ? "DUPLICATED" : null);
        } catch (DataAccessException exception) {
            throw AuthErrors.unavailable();
        }
    }
}
