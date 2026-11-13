package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.repository.PhoneAccountRepository;
import com.runway.backend.domain.auth.repository.PhoneVerificationStore;
import com.runway.backend.domain.auth.validation.PasswordPolicy;
import com.runway.backend.domain.auth.verification.PhoneVerificationPurpose;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.stereotype.Service;

import java.util.List;

/**
 * U30 비밀번호 재설정(users.md, S15P31E105-560). 증명·비밀번호·전화번호를 로그·예외·오류 details에 넣지 않는다.
 *
 * <p>순서: 값·비밀번호 정책 검증(실패해도 증명은 그대로) → 증명 소비 → 그 번호의 ACTIVE 회원 1명 확인 → 해시 계산(트랜잭션 밖) → 잠금 안에서
 * 변경·갱신 권한 폐기. 증명을 소비한 뒤의 실패는 증명을 되살리지 않는다(재인증).
 */
@Service
public class PasswordResetService {
    private final PhoneVerificationStore verifications;
    private final PhoneAccountRepository phones;
    private final MemberPasswordHasher passwords;
    private final PasswordResetTransaction transaction;

    public PasswordResetService(
            PhoneVerificationStore verifications,
            PhoneAccountRepository phones,
            MemberPasswordHasher passwords,
            PasswordResetTransaction transaction) {
        this.verifications = verifications;
        this.phones = phones;
        this.passwords = passwords;
        this.transaction = transaction;
    }

    public void reset(Object tokenValue, Object passwordValue) {
        if (!(tokenValue instanceof String token)
                || token.isEmpty()
                || token.length() > 128
                || !(passwordValue instanceof String password))
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        if (!PasswordPolicy.acceptsNew(password) || sameAsLoginId(token, password))
            throw new ApiException(ErrorCode.INVALID_PASSWORD_POLICY);
        var proof = verifications.consume(token);
        if (proof.isEmpty() || proof.get().purpose() != PhoneVerificationPurpose.PASSWORD_RESET)
            throw new ApiException(ErrorCode.VERIFICATION_EXPIRED);
        try {
            List<Long> users = phones.activeUserIds(proof.get().phoneNumber());
            if (users.isEmpty()) throw new ApiException(ErrorCode.PHONE_NOT_REGISTERED);
            if (users.size() > 1) throw new ApiException(ErrorCode.PHONE_ACCOUNT_AMBIGUOUS);
            String hash = passwords.encode(password);
            transaction.apply(users.getFirst(), hash);
        } catch (ApiException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            // 잠금 시간 초과·DB 오류·커밋 실패: 드라이버 메시지에 입력값이 있을 수 있어 원인을 남기지 않는다.
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
    }

    /**
     * 그 증명 번호의 ACTIVE 회원이 한 명이고 아이디가 비밀번호와 같은지(대소문자 무시, S15P31E105-773). 증명을 소비하지 않고 읽어 정책
     * 위반처럼 다시 입력할 수 있게 한다. 증명이 없거나 목적이 다르거나 회원이 0·2명이면 대조하지 않고 이후 단계의 오류를 따른다.
     */
    private boolean sameAsLoginId(String token, String password) {
        var proof = verifications.peek(token);
        if (proof.isEmpty() || proof.get().purpose() != PhoneVerificationPurpose.PASSWORD_RESET) return false;
        List<String> loginIds;
        try {
            loginIds = phones.activeLoginIds(proof.get().phoneNumber());
        } catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        return loginIds.size() == 1 && PasswordPolicy.sameAsLoginId(password, loginIds.getFirst());
    }
}
