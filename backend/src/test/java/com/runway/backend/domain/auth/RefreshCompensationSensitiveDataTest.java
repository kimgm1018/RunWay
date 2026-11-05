package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.global.security.JwtAccessTokenService;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.*;

@ExtendWith(OutputCaptureExtension.class)
class RefreshCompensationSensitiveDataTest extends RefreshIntegrationSupport {
    @Autowired JwtAccessTokenService spiedAccess;
    @Autowired RefreshTokenStore spiedStore;

    @Test
    void technicalAndCompensationFailureNeverLogCauseOrCredentials(CapturedOutput output)
            throws Exception {
        var token = grant();
        String sensitive = "synthetic-sensitive:" + token.value() + ":Runner9!";
        doThrow(new IllegalStateException(sensitive)).when(spiedAccess).issue(anyLong(), any());
        doThrow(new IllegalStateException(sensitive)).when(spiedStore).logout(any());
        String body =
                request("refresh", token.value())
                        .andExpect(status().isServiceUnavailable())
                        .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        assertThat(body).doesNotContain(token.value(), "Runner9!", "synthetic-sensitive");
        assertThat(output.toString())
                .contains("전달되지 않은 갱신 권한의 폐기를 확인하지 못했습니다.")
                .doesNotContain(token.value(), "Runner9!", "synthetic-sensitive");
    }
}
