package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.service.RetiredLoginId;
import com.runway.backend.domain.user.repository.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import tools.jackson.databind.json.JsonMapper;

class RetiredLoginIdIntegrationTest extends AuthIntegrationSupport {
    @Autowired SignupRepository signup;
    @Autowired UserAccountRepository accounts;
    @Autowired JsonMapper mapper;

    @Test
    void retiredLoginDigestReservesLoginIdRegardlessOfCase() throws Exception {
        String digest = RetiredLoginId.digest("runner01");
        jdbc.update("UPDATE users SET login_id=?,account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?",
                digest, user);
        assertThat(digest).hasSize(64).matches("[0-9a-f]{64}").isNotEqualTo("runner01");
        assertThat(signup.loginIdExists("runner01")).isTrue();
        // S15P31E105-831: 아이디는 대소문자 구분 없이 하나다. 소문자 해시로 예약된 아이디는 대소문자만 달라도 예약돼 있다.
        assertThat(signup.loginIdExists("Runner01")).isTrue();
        assertThat(signup.loginIdExists("RUNNER01")).isTrue();
        mvc.perform(post("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(
                                SignupValidationTest.payload("runner01", "새닉네임", false))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LOGIN_ID_DUPLICATED"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
    }

    @Test
    void retiredNicknameCanBeReusedButActiveNicknameStillHasDatabaseUniqueness() throws Exception {
        jdbc.update("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?", user);
        assertThat(signup.nicknameExists("러너")).isFalse();
        assertThat(accounts.nicknameTakenByOther("러너", -1)).isFalse();
        mvc.perform(post("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(
                                SignupValidationTest.payload("replacement", "러너", false))))
                .andExpect(status().isCreated());
        assertThat(signup.nicknameExists("러너")).isTrue();
        mvc.perform(post("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(
                                SignupValidationTest.payload("secondnew", "러너", false))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NICKNAME_DUPLICATED"));
    }

    @Test
    void multipleRetiredAccountsAllowSameDisplayNicknameAndRequiredFieldsRemainNonNull() {
        jdbc.update("UPDATE users SET account_status='WITHDRAWN',nickname='탈퇴한 회원',withdrawn_at=now() WHERE id=?", user);
        jdbc.update("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,
                    health_data_access,account_status,withdrawn_at)
                VALUES (?, '!WITHDRAWN!', '탈퇴한 회원', '1970-01-01', 'MALE', '00000000000',
                    'DISAGREE', 'WITHDRAWN', now())
                """, RetiredLoginId.digest("retired02"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE nickname='탈퇴한 회원'",
                Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
                  AND table_name='users' AND column_name IN ('password','birth_date','gender','phone_number')
                  AND is_nullable='NO'
                """, Integer.class)).isEqualTo(4);
    }
}
