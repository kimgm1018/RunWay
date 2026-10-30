package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;

import tools.jackson.databind.json.JsonMapper;

@ExtendWith(OutputCaptureExtension.class)
class LoginSensitiveDataTest extends AuthIntegrationSupport {
    @Test
    void noSecretsInErrorsOrLogs(CapturedOutput output) throws Exception {
        String success =
                mvc.perform(
                                post("/api/v1/auth/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"loginId\":\"runner01\",\"password\":\"Runner9!\"}"))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        var body = JsonMapper.builder().build().readTree(success);
        for (String request :
                new String[] {
                    "{\"password\":\"SyntheticSecret9!\"}",
                    "{\"password\":\"SyntheticSecret9!\",",
                    "{\"loginId\":\"runner01\",\"password\":\"SyntheticSecret9!\"}"
                }) {
            String failure =
                    mvc.perform(
                                    post("/api/v1/auth/login")
                                            .contentType(MediaType.APPLICATION_JSON)
                                            .content(request))
                            .andReturn()
                            .getResponse()
                            .getContentAsString();
            assertThat(failure).doesNotContain("SyntheticSecret9!", encoded);
        }
        for (int i = 0; i < 5; i++) {
            String locked =
                    mvc.perform(
                                    post("/api/v1/auth/login")
                                            .contentType(MediaType.APPLICATION_JSON)
                                            .content(
                                                    "{\"loginId\":\"runner01\",\"password\":\"SyntheticSecret9!\"}"))
                            .andReturn()
                            .getResponse()
                            .getContentAsString();
            assertThat(locked)
                    .doesNotContain(
                            "runner01",
                            "SyntheticSecret9!",
                            encoded,
                            body.get("accessToken").asString(),
                            body.get("refreshToken").asString());
        }
        assertThat(output.getAll())
                .doesNotContain(
                        "Runner9!",
                        "SyntheticSecret9!",
                        "runway:auth:attempt:runner01",
                        TEST_PASSWORD,
                        encoded,
                        body.get("accessToken").asString(),
                        body.get("refreshToken").asString());
    }
}
