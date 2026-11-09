package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.PhoneVerificationStore;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.verification.PhoneVerificationPurpose;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import tools.jackson.databind.json.JsonMapper;

import java.util.Map;

/** users.md U30(S15P31E105-560) AC-7·AC-8·AC-16. 준비 회원 runner01은 번호 01000000000, 비밀번호 Runner9!이다. */
@ExtendWith(OutputCaptureExtension.class)
class PasswordResetIntegrationTest extends AuthIntegrationSupport {
    private static final String PHONE = "01000000000";
    private static final String NEW_PASSWORD = "NewRunner9!";

    @Autowired JsonMapper mapper;
    @Autowired PhoneVerificationStore verifications;
    @Autowired RefreshTokenStore refreshStore;

    private String proof(PhoneVerificationPurpose purpose, String token) {
        redis.delete(redis.keys("runway:auth:phone:wait:*"));
        assertThat(verifications.issue(purpose, PHONE, "198.51.100.50", "654321").status()).isEqualTo(1);
        assertThat(verifications.confirm(purpose, PHONE, "654321", token).status()).isEqualTo(1);
        return token;
    }

    private ResultActions reset(Object token, Object password) throws Exception {
        var body = new java.util.HashMap<String, Object>();
        if (token != null) body.put("verificationToken", token);
        if (password != null) body.put("newPassword", password);
        return mvc.perform(post("/api/v1/auth/password-reset")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)));
    }

    private ResultActions login(String password) throws Exception {
        return mvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("loginId", "runner01", "password", password))));
    }

    private String refreshToken() throws Exception {
        var body = login("Runner9!").andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return mapper.readTree(body).get("refreshToken").asString();
    }

    private ResultActions refresh(String token) throws Exception {
        return mvc.perform(post("/api/v1/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("refreshToken", token))));
    }

    @Test
    void 비밀번호를_바꾸고_기존_로그인을_모두_끊는다(CapturedOutput output) throws Exception {
        String before = refreshToken();
        String token = proof(PhoneVerificationPurpose.PASSWORD_RESET, "synthetic-reset-1");
        reset(token, NEW_PASSWORD)
                .andExpect(status().isNoContent())
                .andExpect(header().string("Cache-Control", "no-store"));
        login("Runner9!").andExpect(status().isUnauthorized());
        login(NEW_PASSWORD).andExpect(status().isOk());
        refresh(before).andExpect(status().isUnauthorized());
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isFalse();
        reset(token, NEW_PASSWORD).andExpect(status().isGone());
        assertThat(output.getAll()).doesNotContain(PHONE).doesNotContain(token).doesNotContain(NEW_PASSWORD);
    }

    @Test
    void 증명이_없거나_목적이_다르면_410이고_비밀번호는_그대로다() throws Exception {
        String signUp = proof(PhoneVerificationPurpose.SIGN_UP, "synthetic-reset-2");
        reset(signUp, NEW_PASSWORD)
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("VERIFICATION_EXPIRED"));
        reset("never-issued", NEW_PASSWORD).andExpect(status().isGone());
        login("Runner9!").andExpect(status().isOk());
    }

    @Test
    void 비밀번호_정책_위반은_증명을_쓰지_않는다() throws Exception {
        String token = proof(PhoneVerificationPurpose.PASSWORD_RESET, "synthetic-reset-3");
        reset(token, "short")
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_PASSWORD_POLICY"));
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isTrue();
        reset(token, NEW_PASSWORD).andExpect(status().isNoContent());
    }

    @Test
    void 형식이_틀리면_400이다() throws Exception {
        String token = proof(PhoneVerificationPurpose.PASSWORD_RESET, "synthetic-reset-4");
        reset(null, NEW_PASSWORD).andExpect(status().isBadRequest());
        reset(token, null).andExpect(status().isBadRequest());
        reset(12345, NEW_PASSWORD).andExpect(status().isBadRequest());
        reset(token, 123456789).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isTrue();
    }

    @Test
    void 번호의_회원이_없어지거나_둘이_되면_바꾸지_않는다() throws Exception {
        String twice = proof(PhoneVerificationPurpose.PASSWORD_RESET, "synthetic-reset-5");
        jdbc.update("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('runner02',?,'러너2','2000-01-01','MALE',?,'DISAGREE')
                """, encoded, PHONE);
        reset(twice, NEW_PASSWORD)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PHONE_ACCOUNT_AMBIGUOUS"));
        jdbc.update("DELETE FROM users WHERE login_id='runner02'");

        String gone = proof(PhoneVerificationPurpose.PASSWORD_RESET, "synthetic-reset-6");
        jdbc.update("UPDATE users SET phone_number='01011110000' WHERE id=?", user);
        reset(gone, NEW_PASSWORD)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PHONE_NOT_REGISTERED"));
        jdbc.update("UPDATE users SET phone_number=? WHERE id=?", PHONE, user);
        login("Runner9!").andExpect(status().isOk());
    }

    @Test
    void 갱신_권한_폐기에_실패하면_비밀번호를_바꾸지_않는다() throws Exception {
        String token = proof(PhoneVerificationPurpose.PASSWORD_RESET, "synthetic-reset-7");
        doThrow(new ApiException(ErrorCode.SERVICE_UNAVAILABLE)).when(refreshStore).revokeAll(anyLong());
        reset(token, NEW_PASSWORD)
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
        login("Runner9!").andExpect(status().isOk());
        login(NEW_PASSWORD).andExpect(status().isUnauthorized());
        // 증명은 되살리지 않는다(재인증).
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isFalse();
    }
}
