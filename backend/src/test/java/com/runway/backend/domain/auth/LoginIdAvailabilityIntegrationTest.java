package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;

class LoginIdAvailabilityIntegrationTest extends AuthIntegrationSupport {

    @Test
    void openApiDocumentsRequiredQueryAndAllConsentFields() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath(
                                        "$.paths['/api/v1/auth/login-id/availability'].get.parameters[0].name")
                                .value("loginId"))
                .andExpect(
                        jsonPath(
                                        "$.paths['/api/v1/auth/login-id/availability'].get.parameters[0].in")
                                .value("query"))
                .andExpect(
                        jsonPath(
                                        "$.paths['/api/v1/auth/login-id/availability'].get.parameters[0].required")
                                .value(true))
                .andExpect(
                        jsonPath("$.components.schemas.SignupRequest.properties.consents.type")
                                .value("array"))
                .andExpect(
                        jsonPath(
                                        "$.components.schemas.SignupRequest.properties.consents.items['$ref']")
                                .value("#/components/schemas/SignupConsent"))
                .andExpect(
                        jsonPath("$.components.schemas.SignupRequest.required")
                                .value(
                                        org.hamcrest.Matchers.containsInAnyOrder(
                                                "loginId",
                                                "password",
                                                "nickname",
                                                "birthDate",
                                                "gender",
                                                "phoneNumber",
                                                "consents")))
                .andExpect(
                        jsonPath("$.components.schemas.SignupConsent.properties.consentType.type")
                                .value("string"))
                .andExpect(
                        jsonPath("$.components.schemas.SignupConsent.properties.granted.type")
                                .value("boolean"))
                .andExpect(
                        jsonPath("$.components.schemas.SignupConsent.properties.policyVersion")
                                .doesNotExist());
    }

    @Test
    void availableDuplicatedAndWithdrawnAreReadOnly() throws Exception {
        // 대문자가 섞인 입력도 보낸 그대로 돌려준다(S15P31E105-831, 대소문자 무시 판정은 CaseInsensitiveIdentityIntegrationTest).
        for (String id : new String[] {"abcd", "a".repeat(16), "Newbie01"}) {
            mvc.perform(get("/api/v1/auth/login-id/availability").param("loginId", id))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.available").value(true))
                    .andExpect(jsonPath("$.loginId").value(id))
                    .andExpect(jsonPath("$.reason").value(org.hamcrest.Matchers.nullValue()))
                    .andExpect(header().string("Cache-Control", "no-store"));
        }
        for (boolean withdrawn : new boolean[] {false, true}) {
            if (withdrawn)
                jdbc.update("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=now()");
            mvc.perform(get("/api/v1/auth/login-id/availability").param("loginId", "runner01"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.available").value(false))
                    .andExpect(jsonPath("$.reason").value("DUPLICATED"));
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_settings", Integer.class))
                .isZero();
    }

    @Test
    void invalidAndAmbiguousIdsAreRejected() throws Exception {
        for (String id : new String[] {"", "abc", "a".repeat(17), "한글아이디", "run ner"}) {
            mvc.perform(get("/api/v1/auth/login-id/availability").param("loginId", id))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        mvc.perform(get("/api/v1/auth/login-id/availability")).andExpect(status().isBadRequest());
        mvc.perform(
                        get("/api/v1/auth/login-id/availability")
                                .param("loginId", "runner01", "other01"))
                .andExpect(status().isBadRequest());
    }
}
