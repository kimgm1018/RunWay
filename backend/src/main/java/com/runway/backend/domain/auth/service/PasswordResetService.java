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
        if (!PasswordPolicy.accepts(password))
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
}
