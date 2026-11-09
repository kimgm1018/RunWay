package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.dto.SignupRequest;
import com.runway.backend.domain.auth.validation.SignupValidator;
import com.runway.backend.global.exception.ApiException;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;

class SignupValidationTest {
    final SignupValidator validator =
            new SignupValidator(Clock.fixed(Instant.parse("2026-10-28T00:00:00Z"), ZoneOffset.UTC));

    static Map<String, Object> payload(String login, String nickname, boolean health) {
        var body = new LinkedHashMap<String, Object>();
        body.put("loginId", login);
        body.put("password", "Runner9!");
        body.put("nickname", nickname);
        body.put("birthDate", "2000-01-01");
        body.put("gender", "MALE");
        // 가입마다 다른 번호(S15P31E105-560부터 ACTIVE 회원의 번호는 다시 가입할 수 없다).
        body.put("phoneNumber", "010%08d".formatted(Math.floorMod(login.hashCode(), 100_000_000)));
        body.put(
                "consents",
                new ArrayList<>(
                        List.of(
                                new LinkedHashMap<>(
                                        Map.of("consentType", "TERMS_OF_SERVICE", "granted", true)),
                                new LinkedHashMap<>(
                                        Map.of("consentType", "PERSONAL_INFO", "granted", true)),
                                new LinkedHashMap<>(
                                        Map.of("consentType", "LOCATION_DATA", "granted", true)),
                                new LinkedHashMap<>(
                                        Map.of("consentType", "HEALTH_DATA", "granted", health)))));
        return body;
    }

    static SignupRequest request(Map<String, Object> body) {
        return new SignupRequest(
                body.get("loginId"),
                body.get("password"),
                body.get("nickname"),
                body.get("birthDate"),
                body.get("gender"),
                body.get("phoneNumber"),
                body.get("consents"),
                body.get("phoneVerificationToken"));
    }

    void rejects(Map<String, Object> body, String code, int status) {
        assertThatThrownBy(() -> validator.validate(request(body)))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        error -> {
                            assertThat(error.code()).isEqualTo(code);
                            assertThat(error.status().value()).isEqualTo(status);
                            assertThat(error.details()).isEmpty();
                        });
    }

    @Test
    void requiredFieldsAndJsonTypesAreNotCoerced() {
        for (String key : payload("runner02", "새러너", false).keySet()) {
            for (Object bad : new Object[] {null, 123, true, Map.of()}) {
                var body = payload("runner02", "새러너", false);
                body.put(key, bad);
                rejects(
                        body,
                        key.equals("consents") && bad != null
                                ? "INVALID_CONSENT"
                                : "VALIDATION_ERROR",
                        key.equals("consents") && bad != null ? 422 : 400);
            }
        }
    }

    @Test
    void passwordUnicodeBoundariesAndSpaces() {
        for (String password :
                List.of("a".repeat(8), "a".repeat(20), "😀".repeat(8), "특수문자허용!!!")) {
            var body = payload("runner02", "새러너", false);
            body.put("password", password);
            assertThat(validator.validate(request(body)).password()).isEqualTo(password);
        }
        for (String password :
                List.of(
                        "a".repeat(7),
                        "a".repeat(21),
                        "a bbbbbbb",
                        "a\tbbbbbbb",
                        "a\nbbbbbbb",
                        "a\u00a0bbbbbbb",
                        "\ud800".repeat(8))) {
            var body = payload("runner02", "새러너", false);
            body.put("password", password);
            rejects(body, "INVALID_PASSWORD_POLICY", 422);
        }
    }

    @Test
    void profileBoundariesAndStrictDates() {
        for (String nickname : List.of("가나", "가".repeat(10), "😀".repeat(10))) {
            var body = payload("runner02", nickname, false);
            assertThat(validator.validate(request(body)).nickname()).isEqualTo(nickname);
        }
        for (String nickname : List.of("", "가", "가".repeat(11), "두 글자", "가\u00a0나", "\ud800가")) {
            rejects(payload("runner02", nickname, false), "INVALID_PROFILE", 400);
        }
        for (String date : List.of("2000-02-30", "2000-2-03", "date", "")) {
            var body = payload("runner02", "새러너", false);
            body.put("birthDate", date);
            rejects(body, "VALIDATION_ERROR", 400);
        }
        var future = payload("runner02", "새러너", false);
        future.put("birthDate", "2026-10-29");
        rejects(future, "INVALID_PROFILE", 400);
        for (String phone :
                List.of(
                        "010-1234-5678",
                        "01112345678",
                        "0101234567",
                        "010123456789",
                        " 01012345678")) {
            var body = payload("runner02", "새러너", false);
            body.put("phoneNumber", phone);
            rejects(body, "INVALID_PROFILE", 400);
        }
        var gender = payload("runner02", "새러너", false);
        gender.put("gender", "OTHER");
        rejects(gender, "INVALID_PROFILE", 400);
    }

    @SuppressWarnings("unchecked")
    @Test
    void allFourConsentsMustBeDistinctStrictAndComplete() {
        for (int mode = 0; mode < 5; mode++) {
            var body = payload("runner02", "새러너", false);
            var list = (List<Map<String, Object>>) body.get("consents");
            switch (mode) {
                case 0 -> list.remove(3);
                case 1 -> list.set(3, list.get(0));
                case 2 -> list.get(0).put("granted", false);
                case 3 -> list.get(3).put("granted", "false");
                case 4 -> list.get(3).put("consentType", "UNKNOWN");
            }
            rejects(body, "INVALID_CONSENT", 422);
        }
        assertThat(validator.validate(request(payload("runner02", "새러너", false))).healthGranted())
                .isFalse();
        assertThat(validator.validate(request(payload("runner02", "새러너", true))).healthGranted())
                .isTrue();
    }

    @Test
    void sensitiveObjectsDoNotPrintSubmittedValues() {
        var request = request(payload("runner02", "새러너", false));
        assertThat(request.toString()).isEqualTo("SignupRequest[REDACTED]");
        assertThat(validator.validate(request).toString()).isEqualTo("SignupInput[REDACTED]");
        assertThat(validator.validate(request).consents().getFirst().toString())
                .isEqualTo("Consent[REDACTED]");
    }
}
