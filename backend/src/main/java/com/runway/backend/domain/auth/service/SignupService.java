package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.dto.SignupRequest;
import com.runway.backend.domain.auth.config.SignupSettings;
import com.runway.backend.domain.auth.repository.PhoneAccountRepository;
import com.runway.backend.domain.auth.repository.PhoneVerificationStore;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.verification.PhoneVerificationPurpose;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.domain.auth.validation.SignupValidator;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
    private final PhoneAccountRepository phones;
    private final PhoneVerificationStore verifications;
    private final SignupSettings settings;

    public SignupService(
            SignupValidator validator,
            SignupRepository users,
            MemberPasswordHasher passwords,
            SignupIssuanceService issuance,
            RefreshTokenStore store,
            PhoneAccountRepository phones,
            PhoneVerificationStore verifications,
            SignupSettings settings) {
        this.validator = validator;
        this.users = users;
        this.passwords = passwords;
        this.issuance = issuance;
        this.store = store;
        this.phones = phones;
        this.verifications = verifications;
        this.settings = settings;
    }

    public LoginResponse signup(SignupRequest request) {
        var input = validator.validate(request);
        var proofToken = SignupValidator.verificationToken(request);
        // 증명 없는 가입은 개발·테스트 설정에서만 허용한다(users.md U15, S15P31E105-560).
        if (proofToken.isEmpty() && !settings.isUnverifiedPhoneAllowed())
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        var attempt = new AtomicReference<IssuedRefreshToken>();
        try {
            if (users.loginIdExists(input.loginId()))
                throw new ApiException(ErrorCode.LOGIN_ID_DUPLICATED);
            if (users.nicknameExists(input.nickname()))
                throw new ApiException(ErrorCode.NICKNAME_DUPLICATED);
            // 아이디·닉네임 사전 확인을 통과한 뒤에 증명을 소비한다. 이후 실패하면 증명은 되살리지 않는다(재인증).
            if (proofToken.isPresent()) {
                var proof = verifications.consume(proofToken.get());
                if (proof.isEmpty()
                        || proof.get().purpose() != PhoneVerificationPurpose.SIGN_UP
                        || !proof.get().phoneNumber().equals(input.phoneNumber()))
                    throw new ApiException(ErrorCode.VERIFICATION_EXPIRED);
            }
            // 번호 중복은 증명을 확인한 뒤에 판정한다. 증명 없이 가입 여부를 알 수 없게 한다(users.md U15, 리뷰 R-1).
            if (!phones.activeUserIds(input.phoneNumber()).isEmpty())
                throw new ApiException(ErrorCode.PHONE_ALREADY_REGISTERED);
            String hash = passwords.encode(input.password());
            // Invocation through a separate bean returns only after the DB commit completes.
            return issuance.create(input, hash, attempt);
        } catch (RuntimeException exception) {
            var token = attempt.get();
            if (token != null && !store.revokeUndelivered(token))
                log.warn("전달되지 않은 가입 권한의 폐기를 확인하지 못했습니다.");
            if (exception instanceof ApiException api) throw api;
            String constraint = uniqueConstraint(exception);
            if ("uq_users_login_id".equals(constraint))
                throw new ApiException(ErrorCode.LOGIN_ID_DUPLICATED);
            if ("uq_users_nickname".equals(constraint))
                throw new ApiException(ErrorCode.NICKNAME_DUPLICATED);
            // Driver exceptions can contain submitted values; never attach or log the cause.
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
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
}
