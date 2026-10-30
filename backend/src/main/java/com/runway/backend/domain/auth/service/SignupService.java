package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.dto.SignupRequest;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.domain.auth.validation.SignupValidator;
import com.runway.backend.global.exception.ApiException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicReference;

@Service
public class SignupService {
    private static final Logger log = LoggerFactory.getLogger(SignupService.class);
    private final SignupValidator validator;
    private final SignupRepository users;
    private final MemberPasswordHasher passwords;
    private final SignupIssuanceService issuance;
    private final RefreshTokenStore store;

    public SignupService(
            SignupValidator validator,
            SignupRepository users,
            MemberPasswordHasher passwords,
            SignupIssuanceService issuance,
            RefreshTokenStore store) {
        this.validator = validator;
        this.users = users;
        this.passwords = passwords;
        this.issuance = issuance;
        this.store = store;
    }

    public LoginResponse signup(SignupRequest request) {
        var input = validator.validate(request);
        var attempt = new AtomicReference<IssuedRefreshToken>();
        try {
            if (users.loginIdExists(input.loginId())) throw duplicate("LOGIN_ID_DUPLICATED");
            if (users.nicknameExists(input.nickname())) throw duplicate("NICKNAME_DUPLICATED");
            String hash = passwords.encode(input.password());
            // Invocation through a separate bean returns only after the DB commit completes.
            return issuance.create(input, hash, attempt);
        } catch (RuntimeException exception) {
            var token = attempt.get();
            if (token != null && !store.revokeUndelivered(token))
                log.warn("전달되지 않은 가입 권한의 폐기를 확인하지 못했습니다.");
            if (exception instanceof ApiException api) throw api;
            String constraint = uniqueConstraint(exception);
            if ("uq_users_login_id".equals(constraint)) throw duplicate("LOGIN_ID_DUPLICATED");
            if ("uq_users_nickname".equals(constraint)) throw duplicate("NICKNAME_DUPLICATED");
            // Driver exceptions can contain submitted values; never attach or log the cause.
            throw AuthErrors.unavailable();
        }
    }

    private static String uniqueConstraint(Throwable exception) {
        for (Throwable current = exception; current != null; current = current.getCause()) {
            if (current instanceof SQLException sql && "23505".equals(sql.getSQLState())) {
                // PostgreSQL driver is runtime-only; read structured constraint metadata
                // reflectively.
                try {
                    Object message =
                            current.getClass().getMethod("getServerErrorMessage").invoke(current);
                    return (String) message.getClass().getMethod("getConstraint").invoke(message);
                } catch (ReflectiveOperationException | NullPointerException ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    private static ApiException duplicate(String code) {
        return new ApiException(
                HttpStatus.CONFLICT,
                code,
                code.equals("LOGIN_ID_DUPLICATED") ? "이미 사용 중인 아이디입니다." : "이미 사용 중인 닉네임입니다.");
    }
}
