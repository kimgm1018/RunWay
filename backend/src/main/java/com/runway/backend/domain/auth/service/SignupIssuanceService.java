package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.domain.auth.validation.SignupValidator.Input;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
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
        // 같은 번호의 동시 가입은 잠금으로 순서를 정한다(users.md U15, S15P31E105-560). 먼저 넣어 아이디·닉네임 UNIQUE가
        // 기존처럼 경합을 판정하게 한 뒤, 번호 중복이면 이 트랜잭션을 롤백한다.
        users.lockPhone(input.phoneNumber());
        long id = users.insertUser(input, hash);
        if (users.otherActivePhoneExists(input.phoneNumber(), id))
            throw new ApiException(ErrorCode.PHONE_ALREADY_REGISTERED);
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
