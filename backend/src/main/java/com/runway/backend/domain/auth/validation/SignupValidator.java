package com.runway.backend.domain.auth.validation;

import com.runway.backend.domain.auth.dto.SignupRequest;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class SignupValidator {
    /** 앱 생년 휠의 첫 해(S15P31E105-520). 그 전 날짜는 앱에서 고를 수 없어 서버도 받지 않는다(S15P31E105-779). */
    public static final int MIN_BIRTH_YEAR = 1950;

    private static final Set<String> TYPES =
            Set.of("TERMS_OF_SERVICE", "PERSONAL_INFO", "LOCATION_DATA", "HEALTH_DATA");
    private final Clock clock;

    public SignupValidator(Clock clock) {
        this.clock = clock;
    }

    public Input validate(SignupRequest request) {
        Object[] values = {
            request.loginId(),
            request.password(),
            request.nickname(),
            request.birthDate(),
            request.gender(),
            request.phoneNumber()
        };
        for (Object value : values) {
            if (!(value instanceof String)) throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        String loginId = (String) request.loginId();
        validateLoginId(loginId);
        String password = (String) request.password();
        if (!PasswordPolicy.accepts(password))
            throw new ApiException(ErrorCode.INVALID_PASSWORD_POLICY);
        String nickname = (String) request.nickname();
        if (!text(nickname, 2, 10, false)) throw new ApiException(ErrorCode.INVALID_PROFILE);
        LocalDate birth;
        try {
            String raw = (String) request.birthDate();
            if (!raw.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
                throw new ApiException(ErrorCode.VALIDATION_ERROR);
            birth = LocalDate.parse(raw);
        } catch (DateTimeParseException exception) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        if (birth.getYear() < MIN_BIRTH_YEAR
                || birth.isAfter(LocalDate.now(clock.withZone(ZoneOffset.UTC))))
            throw new ApiException(ErrorCode.INVALID_PROFILE);
        String gender = (String) request.gender();
        String phone = (String) request.phoneNumber();
        if (!Set.of("MALE", "FEMALE").contains(gender) || !phone.matches("010[0-9]{8}"))
            throw new ApiException(ErrorCode.INVALID_PROFILE);
        if (request.consents() == null) throw new ApiException(ErrorCode.VALIDATION_ERROR);
        List<Consent> consents = consents(request.consents());
        return new Input(loginId, password, nickname, birth, gender, phone, consents);
    }

    /** 인증 증명(users.md U15, S15P31E105-560). 없으면 비어 있고, 문자열이 아니거나 비정상 길이면 400이다. */
    public static java.util.Optional<String> verificationToken(SignupRequest request) {
        Object value = request.phoneVerificationToken();
        if (value == null) return java.util.Optional.empty();
        if (!(value instanceof String token) || token.isEmpty() || token.length() > 128)
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        return java.util.Optional.of(token);
    }

    public static void validateLoginId(String loginId) {
        if (loginId == null || !loginId.matches("[A-Za-z0-9]{4,16}"))
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
    }

    private static List<Consent> consents(Object raw) {
        if (!(raw instanceof List<?> list) || list.size() != 4)
            throw new ApiException(ErrorCode.INVALID_CONSENT);
        var seen = new HashSet<String>();
        var result = new ArrayList<Consent>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> entry)
                    || !(entry.get("consentType") instanceof String type)
                    || !TYPES.contains(type)
                    || !seen.add(type)
                    || !(entry.get("granted") instanceof Boolean granted)
                    || (!type.equals("HEALTH_DATA") && !granted))
                throw new ApiException(ErrorCode.INVALID_CONSENT);
            result.add(new Consent(type, granted));
        }
        return List.copyOf(result);
    }

    private static boolean text(String value, int min, int max, boolean allowSpaces) {
        int count = 0;
        for (int offset = 0; offset < value.length(); ) {
            char first = value.charAt(offset);
            if (Character.isSurrogate(first)
                    && (!Character.isHighSurrogate(first)
                            || offset + 1 >= value.length()
                            || !Character.isLowSurrogate(value.charAt(offset + 1)))) return false;
            int point = value.codePointAt(offset);
            if (Character.isISOControl(point)
                    || (!allowSpaces
                            && (Character.isWhitespace(point) || Character.isSpaceChar(point))))
                return false;
            count++;
            if (count > max) return false;
            offset += Character.charCount(point);
        }
        return count >= min;
    }

    public record Consent(String type, boolean granted) {
        @Override
        public String toString() {
            return "Consent[REDACTED]";
        }
    }

    public record Input(
            String loginId,
            String password,
            String nickname,
            LocalDate birthDate,
            String gender,
            String phoneNumber,
            List<Consent> consents) {
        public boolean healthGranted() {
            return consents.stream()
                    .filter(c -> c.type().equals("HEALTH_DATA"))
                    .findFirst()
                    .orElseThrow()
                    .granted();
        }

        @Override
        public String toString() {
            return "SignupInput[REDACTED]";
        }
    }
}
