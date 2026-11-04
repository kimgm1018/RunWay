package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.dto.*;
import com.runway.backend.domain.auth.service.RefreshTokenFactory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.*;

@ExtendWith(OutputCaptureExtension.class)
class RefreshLogoutSensitiveDataTest extends RefreshIntegrationSupport {
    @Test
    void redactsTokensInFailurePaths(CapturedOutput output) throws Exception {
        var token = grant();
        var result = refresh.refresh(token.value());
        assertThat(new RefreshTokenRequest(token.value()).toString()).doesNotContain(token.value());
        assertThat(result.toString()).doesNotContain(result.accessToken(), result.refreshToken());
        assertThat(RefreshTokenFactory.parse(token.value()).toString())
                .doesNotContain(token.hash());
        assertThat(redis.opsForHash().entries(key(token)).values())
                .doesNotContain(token.value(), result.refreshToken(), result.accessToken());
        String failure =
                request("refresh", token.value())
                        .andExpect(status().isUnauthorized())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        assertThat(failure)
                .doesNotContain(token.value(), result.refreshToken(), result.accessToken());
        assertThat(output.toString())
                .doesNotContain(token.value(), result.refreshToken(), result.accessToken());
    }
}
