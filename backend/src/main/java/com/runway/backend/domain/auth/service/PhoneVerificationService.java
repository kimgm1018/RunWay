package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.PhoneVerificationConfirmResponse;
import com.runway.backend.domain.auth.dto.PhoneVerificationResponse;
import com.runway.backend.domain.auth.repository.PhoneAccountRepository;
import com.runway.backend.domain.auth.repository.PhoneVerificationStore;
import com.runway.backend.domain.auth.verification.PhoneVerificationPurpose;
import com.runway.backend.domain.auth.verification.SmsPort;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * U28 인증번호 요청·U29 확인(users.md, S15P31E105-560). 전화번호·인증번호·증명을 로그·예외·오류 details에 넣지 않는다.
 *
 * <p>SMS 호출은 DB 트랜잭션 밖에서 한 번만 한다. 공급자에 중복 방지 키가 없어 결과가 불명확해도 다시 보내지 않는다.
 */
@Service
public class PhoneVerificationService {
    static final int MAX_ATTEMPTS = 5;
    private static final Pattern PHONE = Pattern.compile("010[0-9]{8}");
    private static final Pattern CODE = Pattern.compile("[0-9]{6}");

    private final PhoneAccountRepository accounts;
    private final PhoneVerificationStore store;
    private final SmsPort sms;
    private final SecureRandom random = new SecureRandom();

    public PhoneVerificationService(
            PhoneAccountRepository accounts, PhoneVerificationStore store, SmsPort sms) {
        this.accounts = accounts;
        this.store = store;
        this.sms = sms;
    }

    public PhoneVerificationResponse request(Object phoneValue, Object purposeValue, String ip) {
        String phone = phone(phoneValue);
        var purpose = purpose(purposeValue);
        if (!sms.enabled()) throw new ApiException(ErrorCode.SMS_UNAVAILABLE);
        // 가입 여부는 확인하지 않는다. 휴대전화가 없는 사람이 응답 차이로 가입 여부를 알아내지 못하게 U29에서만 알려 준다.
        String code = "%06d".formatted(random.nextInt(1_000_000));
        var issued = store.issue(purpose, phone, ip, code);
        switch (issued.status()) {
            case 1 -> {}
            case -2 -> throw retry(ErrorCode.VERIFICATION_RESEND_TOO_SOON, issued.value());
            case -3 -> throw retry(ErrorCode.VERIFICATION_SEND_LIMIT_EXCEEDED, issued.value());
            default -> throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
        var result = sms.send(phone, "[Runway] 본인확인 인증번호 [" + code + "]");
        if (result == SmsPort.Result.REJECTED) {
            store.discard(purpose, phone, code);
            throw new ApiException(ErrorCode.SMS_UNAVAILABLE);
        }
        // UNKNOWN: 실제로 보내졌을 수 있어 인증번호를 남긴다. 사용자는 받았으면 확인하고, 아니면 대기 뒤 다시 요청한다.
        if (result != SmsPort.Result.ACCEPTED) throw new ApiException(ErrorCode.SMS_UNAVAILABLE);
        return new PhoneVerificationResponse(issued.value(), 60);
    }

    public PhoneVerificationConfirmResponse confirm(
            Object phoneValue, Object purposeValue, Object codeValue) {
        String phone = phone(phoneValue);
        var purpose = purpose(purposeValue);
        if (!(codeValue instanceof String code) || !CODE.matcher(code).matches())
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        String token = newToken();
        var confirmed = store.confirm(purpose, phone, code, token);
        return switch (confirmed.status()) {
            case 1 -> {
                checkRegistration(purpose, phone, token);
                yield new PhoneVerificationConfirmResponse(token, confirmed.value());
            }
            case -1 -> throw new ApiException(ErrorCode.VERIFICATION_EXPIRED);
            case -5 -> throw new ApiException(
                    ErrorCode.VERIFICATION_CODE_MISMATCH,
                    Map.of("failedCount", confirmed.value(), "maxAttempts", MAX_ATTEMPTS));
            case -4 -> throw new ApiException(
                    ErrorCode.VERIFICATION_ATTEMPTS_EXCEEDED,
                    Map.of("failedCount", confirmed.value(), "maxAttempts", MAX_ATTEMPTS));
            default -> throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        };
    }

    /** 인증번호를 맞힌 뒤에만 가입 여부를 알려 준다. 진행할 수 없으면 방금 저장한 증명을 지운다. */
    private void checkRegistration(PhoneVerificationPurpose purpose, String phone, String token) {
        try {
            List<Long> users = accounts.activeUserIds(phone);
            if (purpose == PhoneVerificationPurpose.SIGN_UP && !users.isEmpty())
                throw new ApiException(ErrorCode.PHONE_ALREADY_REGISTERED);
            if (purpose == PhoneVerificationPurpose.PASSWORD_RESET) {
                if (users.isEmpty()) throw new ApiException(ErrorCode.PHONE_NOT_REGISTERED);
                if (users.size() > 1) throw new ApiException(ErrorCode.PHONE_ACCOUNT_AMBIGUOUS);
            }
        } catch (ApiException exception) {
            discardProof(token);
            throw exception;
        } catch (RuntimeException exception) {
            // DB 오류 등: 드라이버 메시지에 입력값이 있을 수 있어 원인을 남기지 않는다.
            discardProof(token);
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
    }

    private void discardProof(String token) {
        try {
            store.consume(token);
        } catch (RuntimeException ignored) {
            // 지우지 못해도 증명은 600초 뒤 만료되고, U15·U30이 가입 상태를 다시 확인한다.
        }
    }

    private static String phone(Object value) {
        if (!(value instanceof String phone) || !PHONE.matcher(phone).matches())
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        return phone;
    }

    private static PhoneVerificationPurpose purpose(Object value) {
        return PhoneVerificationPurpose.parse(value)
                .orElseThrow(() -> new ApiException(ErrorCode.VALIDATION_ERROR));
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static ApiException retry(ErrorCode code, long seconds) {
        return new ApiException(code, Map.of("retryAfterSec", Math.max(1, seconds)));
    }
}
