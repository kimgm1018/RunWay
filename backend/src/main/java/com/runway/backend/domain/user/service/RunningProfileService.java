package com.runway.backend.domain.user.service;

import com.runway.backend.domain.user.dto.request.RunningProfileRequest;
import com.runway.backend.domain.user.dto.response.RunningProfileResponse;
import com.runway.backend.domain.user.validation.RunningProfileValidator;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import jakarta.persistence.PersistenceException;

import lombok.RequiredArgsConstructor;

import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.TransactionException;

import java.util.function.Supplier;

@Service
@RequiredArgsConstructor
public class RunningProfileService {
    private final RunningProfileValidator validator;
    private final RunningProfileTransactions transactions;

    public RunningProfileResponse readProfile(long userId) {
        return storage(() -> transactions.readProfile(userId));
    }

    public RunningProfileResponse saveProfile(long userId, RunningProfileRequest request) {
        var input = validator.profile(request);
        return storage(() -> transactions.saveProfile(userId, input));
    }

    private <T> T storage(Supplier<T> action) {
        try {
            // A separate proxied bean finishes commit before success escapes this boundary.
            return action.get();
        } catch (DataAccessException | TransactionException | PersistenceException exception) {
            // Do not expose driver messages, SQL, submitted values, or exception causes.
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
    }
}
