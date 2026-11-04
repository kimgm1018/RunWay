package com.runway.backend.domain.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class RefreshLogoutValidationTest extends RefreshIntegrationSupport {
    @Test
    void rejectsMalformedInputs() throws Exception {
        for (String endpoint : new String[] {"refresh", "logout"}) {
            for (String body :
                    new String[] {
                        "{",
                        "{}",
                        "null",
                        "[]",
                        "{\"refreshToken\":null}",
                        "{\"refreshToken\":\"\"}",
                        "{\"refreshToken\":\"  \\t\"}",
                        "{\"refreshToken\":\"\\u00a0\"}",
                        "{\"refreshToken\":12}",
                        "{\"refreshToken\":true}",
                        "{\"refreshToken\":[]}",
                        "{\"refreshToken\":{}}"
                    }) {
                mvc.perform(
                                post("/api/v1/auth/" + endpoint)
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(body))
                        .andExpect(status().isBadRequest())
                        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
            }
        }
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath(
                                        "$.components.schemas.RefreshTokenRequest.properties.refreshToken.type")
                                .value("string"));
    }
}
