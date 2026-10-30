package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.domain.auth.validation.SignupValidator.Input;
import com.runway.backend.global.security.JwtAccessTokenService;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.concurrent.atomic.AtomicReference;

@Service
public class SignupIssuanceService {
    private final SignupRepository users;
    private final RefreshTokenFactory tokens;
    private final JwtAccessTokenService access;
    private final RefreshTokenStore store;
    private final Clock clock;

    public SignupIssuanceService(
            SignupRepository users,
            RefreshTokenFactory tokens,
            JwtAccessTokenService access,
            RefreshTokenStore store,
            Clock clock) {
        this.users = users;
        this.tokens = tokens;
        this.access = access;
        this.store = store;
        this.clock = clock;
    }

    @Transactional
    public LoginResponse create(
            Input input, String hash, AtomicReference<IssuedRefreshToken> attempt) {
        long id = users.insertUser(input, hash);
        users.insertSettings(id);
        var refresh = tokens.create(id, clock.instant());
        // The caller retains the grant even if this transaction's commit fails.
        attempt.set(refresh);
        var jwt = access.issue(id, refresh.expiresAt());
        store.create(refresh);
        return new LoginResponse(
                new LoginResponse.User(id, input.loginId()),
                jwt.accessToken(),
                refresh.value(),
                jwt.expiresInSec(),
                refresh.expiresAt(),
                false);
    }
}
