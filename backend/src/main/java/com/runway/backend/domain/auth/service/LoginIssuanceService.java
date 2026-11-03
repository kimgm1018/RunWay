package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.repository.AuthUserRepository;
import com.runway.backend.domain.auth.repository.AuthUserRepository.Account;
import com.runway.backend.domain.auth.repository.LoginAttemptStore;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.domain.user.service.OnboardingStatusService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.security.JwtAccessTokenService;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LoginIssuanceService {
    private final AuthUserRepository users;
    private final RefreshTokenStore store;
    private final JwtAccessTokenService accessTokens;
    private final LoginAttemptStore attempts;
    private final OnboardingStatusService onboarding;

    public LoginIssuanceService(
            AuthUserRepository users,
            RefreshTokenStore store,
            JwtAccessTokenService accessTokens,
            LoginAttemptStore attempts,
            OnboardingStatusService onboarding) {
        this.users = users;
        this.store = store;
        this.accessTokens = accessTokens;
        this.attempts = attempts;
        this.onboarding = onboarding;
    }

    @Transactional
    public LoginResponse issue(Account verified, IssuedRefreshToken refresh) {
        Account current = users.lock(verified.id()).orElse(null);
        if (current == null
                || !current.active()
                || !current.passwordHash().equals(verified.passwordHash()))
            throw new ApiException(
                    attempts.recordFailure(verified.loginId()) == 5
                            ? ErrorCode.LOGIN_LOCKED
                            : ErrorCode.INVALID_CREDENTIALS);
        boolean completed = onboarding.isCompleted(current.id());
        var access = accessTokens.issue(current.id(), refresh.expiresAt());
        store.createForLogin(refresh, current.loginId());
        return new LoginResponse(
                new LoginResponse.User(current.id(), current.loginId()),
                access.accessToken(),
                refresh.value(),
                access.expiresInSec(),
                refresh.expiresAt(),
                completed);
    }
}
