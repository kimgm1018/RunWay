package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.repository.AuthUserRepository;
import com.runway.backend.domain.auth.repository.LoginAttemptStore;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.validation.SignupValidator;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

import java.time.Clock;

@Service
public class LoginService {
    private static final Logger log = LoggerFactory.getLogger(LoginService.class);
    private final AuthUserRepository users;
    private final MemberPasswordHasher passwords;
    private final RefreshTokenFactory tokens;
    private final LoginIssuanceService issuance;
    private final RefreshTokenStore store;
    private final Clock clock;
    private final LoginAttemptStore attempts;

    public LoginService(
            AuthUserRepository users,
            MemberPasswordHasher passwords,
            RefreshTokenFactory tokens,
            LoginIssuanceService issuance,
            RefreshTokenStore store,
            Clock clock,
            LoginAttemptStore attempts) {
        this.users = users;
        this.passwords = passwords;
        this.tokens = tokens;
        this.issuance = issuance;
        this.store = store;
        this.clock = clock;
        this.attempts = attempts;
    }

    public LoginResponse login(String submittedLoginId, String password) {
        // 대소문자 구분 없이 같은 아이디로 보고 실패 제한도 한 키로 모은다(users.md U01, S15P31E105-831).
        String loginId = SignupValidator.normalizeLoginId(submittedLoginId);
        try {
            attempts.ensureAllowed(loginId);
            var found = users.findByLoginId(loginId);
            if (found.isEmpty() || !found.get().active()) {
                passwords.verifyDummy(password);
                throw new ApiException(
                        attempts.recordFailure(loginId) == 5
                                ? ErrorCode.LOGIN_LOCKED
                                : ErrorCode.INVALID_CREDENTIALS);
            }
            var account = found.get();
            if (!passwords.matches(password, account.passwordHash()))
                throw new ApiException(
                        attempts.recordFailure(loginId) == 5
                                ? ErrorCode.LOGIN_LOCKED
                                : ErrorCode.INVALID_CREDENTIALS);
            var refresh = tokens.create(account.id(), clock.instant());
            try {
                return issuance.issue(account, refresh);
            } catch (RuntimeException exception) {
                if (!store.revokeUndelivered(refresh)) log.warn("전달되지 않은 로그인 권한의 폐기를 확인하지 못했습니다.");
                if (exception instanceof ApiException api) throw api;
                throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
            }
        } catch (DataAccessException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
    }
}
