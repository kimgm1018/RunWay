package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.repository.AuthUserRepository;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * U30 비밀번호 변경 트랜잭션(users.md, S15P31E105-560, BE-A 확인).
 *
 * <p>로그인·갱신과 같은 사용자 잠금({@link AuthUserRepository#lock})을 잡고 비밀번호를 바꾼 뒤, 같은 잠금 안에서 그 회원의 모든 갱신 권한을
 * 폐기한다. 폐기가 실패하면 예외로 롤백해 비밀번호를 바꾸지 않는다. 별도 빈이라 호출이 끝나면 커밋까지 끝난 상태다.
 */
@Service
public class PasswordResetTransaction {
    private final AuthUserRepository users;
    private final RefreshTokenStore store;

    public PasswordResetTransaction(AuthUserRepository users, RefreshTokenStore store) {
        this.users = users;
        this.store = store;
    }

    @Transactional
    public void apply(long userId, String hash) {
        var account = users.lock(userId).orElse(null);
        if (account == null || !account.active())
            throw new ApiException(ErrorCode.PHONE_NOT_REGISTERED);
        users.updatePassword(userId, hash);
        // 실패하면 ApiException(503)으로 롤백한다. 일부 계열이 이미 폐기됐을 수 있으나 되살리지 않는다.
        store.revokeAll(userId);
    }
}
