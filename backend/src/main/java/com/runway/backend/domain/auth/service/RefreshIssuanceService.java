package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.RefreshResponse;
import com.runway.backend.domain.auth.repository.AuthUserRepository;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.repository.RefreshTokenStore.Family;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.PresentedToken;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.security.JwtAccessTokenService;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;

@Service
public class RefreshIssuanceService {
    private final AuthUserRepository users;
    private final RefreshTokenStore store;
    private final RefreshTokenFactory tokens;
    private final JwtAccessTokenService accessTokens;
    private final Clock clock;

    public RefreshIssuanceService(
            AuthUserRepository users,
            RefreshTokenStore store,
            RefreshTokenFactory tokens,
            JwtAccessTokenService accessTokens,
            Clock clock) {
        this.users = users;
        this.store = store;
        this.tokens = tokens;
        this.accessTokens = accessTokens;
        this.clock = clock;
    }

    @Transactional
    public RefreshResponse issue(PresentedToken token, Family family) {
        var account = users.lock(family.userId()).orElse(null);
        if (account == null || !account.active())
            throw new ApiException(ErrorCode.INVALID_REFRESH_TOKEN);
        if (Duration.between(clock.instant(), family.expiresAt()).compareTo(Duration.ofSeconds(1))
                < 0) throw new ApiException(ErrorCode.INVALID_REFRESH_TOKEN);
        var replacement =
                tokens.rotate(
                        family.userId(), token.familyId(), family.createdAt(), family.expiresAt());
        com.runway.backend.global.security.JwtAccessTokenService.IssuedAccessToken access;
        try {
            access = accessTokens.issue(account.id(), family.expiresAt());
        } catch (IllegalArgumentException exception) {
            if (Duration.between(clock.instant(), family.expiresAt())
                            .compareTo(Duration.ofSeconds(1))
                    < 0) throw new ApiException(ErrorCode.INVALID_REFRESH_TOKEN);
            throw exception;
        }
        store.rotate(token, replacement, clock.instant());
        return new RefreshResponse(
                access.accessToken(),
                replacement.value(),
                access.expiresInSec(),
                family.expiresAt());
    }
}
