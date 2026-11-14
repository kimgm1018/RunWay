package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.config.SignupSettings;
import com.runway.backend.domain.auth.repository.AuthUserRepository;
import com.runway.backend.domain.auth.repository.LoginAttemptStore;
import com.runway.backend.domain.auth.repository.PhoneVerificationStore;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.service.RetiredLoginId;
import com.runway.backend.domain.auth.verification.PhoneVerificationPurpose;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import tools.jackson.databind.json.JsonMapper;

import java.sql.SQLException;
import java.util.Map;

/**
 * S15P31E105-831: 닉네임·아이디는 대소문자와 관계없이 하나만 존재한다. 준비 회원은 ACTIVE {@code runner01}(닉네임 러너, 비밀번호
 * Runner9!)이다. 플랜 T-1·T-4~T-9·T-11·T-12.
 */
class CaseInsensitiveIdentityIntegrationTest extends AuthIntegrationSupport {
    @Autowired JsonMapper mapper;
    @Autowired SignupSettings settings;
    @Autowired PhoneVerificationStore verifications;
    @Autowired SignupRepository signupRepository;
    @Autowired AuthUserRepository authUsers;

    @AfterEach
    void restoreTestDefault() {
        settings.setUnverifiedPhoneAllowed(true);
        jdbc.execute("DROP INDEX IF EXISTS tmp_uq_users_birth_date");
    }

    private ResultActions signup(String login, String nickname) throws Exception {
        return signup(login, nickname, null, null);
    }

    private ResultActions signup(String login, String nickname, String phone, String token)
            throws Exception {
        Map<String, Object> body = SignupValidationTest.payload(login, nickname, false);
        if (phone != null) body.put("phoneNumber", phone);
        if (token != null) body.put("phoneVerificationToken", token);
        return mvc.perform(
                post("/api/v1/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(body)));
    }

    private ResultActions login(String loginId, String password) throws Exception {
        return mvc.perform(
                post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                mapper.writeValueAsString(
                                        Map.of("loginId", loginId, "password", password))));
    }

    private ResultActions availability(String loginId) throws Exception {
        return mvc.perform(get("/api/v1/auth/login-id/availability").param("loginId", loginId));
    }

    private String proof(String phone, String token) {
        redis.delete(redis.keys("runway:auth:phone:wait:*"));
        assertThat(
                        verifications
                                .issue(PhoneVerificationPurpose.SIGN_UP, phone, "198.51.100.83", "831831")
                                .status())
                .isEqualTo(1);
        assertThat(
                        verifications
                                .confirm(PhoneVerificationPurpose.SIGN_UP, phone, "831831", token)
                                .status())
                .isEqualTo(1);
        return token;
    }

    private int users() {
        return jdbc.queryForObject("SELECT count(*) FROM users", Integer.class);
    }

    // AC-1·AC-3: 대소문자만 다른 닉네임은 409이고 증명은 소비되지 않는다. 저장은 입력 그대로다.
    @Test
    void 닉네임_대소문자만_다르면_409_저장은_입력그대로() throws Exception {
        signup("quser001", "QI유저1").andExpect(status().isCreated());
        settings.setUnverifiedPhoneAllowed(false);
        String phone = "01083100001";
        String token = proof(phone, "synthetic-proof-831");
        int before = users();
        for (String nickname : new String[] {"qi유저1", "Qi유저1", "QI유저1"}) {
            signup("quser002", nickname, phone, token)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("NICKNAME_DUPLICATED"));
        }
        assertThat(users()).isEqualTo(before);
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isTrue();
        signup("quser002", "QiRunner", phone, token).andExpect(status().isCreated());
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isFalse();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT nickname FROM users WHERE login_id='quser002'",
                                String.class))
                .isEqualTo("QiRunner");
        settings.setUnverifiedPhoneAllowed(true);
        // 한글은 대소문자가 없어 lower()가 값을 바꾸지 않는다.
        assertThat(jdbc.queryForObject("SELECT lower('가힣러너')", String.class))
                .isEqualTo("가힣러너");
        signup("quser003", "러너").andExpect(status().isConflict());
        signup("quser003", "qirunner")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NICKNAME_DUPLICATED"));
    }

    // AC-6: 아이디는 소문자로 저장하고 응답도 저장값이다. 대소문자만 다르면 409이고 증명은 소비되지 않는다.
    @Test
    void 아이디는_소문자로_저장되고_대소문자만_다르면_409() throws Exception {
        String body =
                signup("Newbie01", "새러너")
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.user.loginId").value("newbie01"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long id = mapper.readTree(body).get("user").get("id").asLong();
        assertThat(jdbc.queryForObject("SELECT login_id FROM users WHERE id=?", String.class, id))
                .isEqualTo("newbie01");
        settings.setUnverifiedPhoneAllowed(false);
        String phone = "01083100002";
        String token = proof(phone, "synthetic-proof-831b");
        int before = users();
        for (String login : new String[] {"RUNNER01", "Runner01", "NEWBIE01"}) {
            signup(login, "다른러너", phone, token)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("LOGIN_ID_DUPLICATED"));
        }
        assertThat(users()).isEqualTo(before);
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isTrue();
    }

    // AC-7: U16은 대소문자 무시로 판정하고 보낸 값을 그대로 돌려준다(앱이 입력값과 비교한다).
    @Test
    void U16_대소문자_무시로_판정하고_보낸값을_돌려준다() throws Exception {
        availability("RUNNER01")
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.loginId").value("RUNNER01"))
                .andExpect(jsonPath("$.available").value(false))
                .andExpect(jsonPath("$.reason").value("DUPLICATED"));
        availability("Newbie01")
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.loginId").value("Newbie01"))
                .andExpect(jsonPath("$.available").value(true))
                .andExpect(jsonPath("$.reason").value(org.hamcrest.Matchers.nullValue()));
        assertThat(users()).isEqualTo(1);
    }

    // AC-8: 대소문자와 관계없이 로그인되고 응답 loginId는 저장값이다.
    @Test
    void 대소문자와_관계없이_로그인() throws Exception {
        for (String id : new String[] {"Runner01", "RUNNER01", "runner01"}) {
            login(id, "Runner9!")
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.user.loginId").value("runner01"));
        }
        login("RUNNER01", "Wrong999!")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    // 리뷰 A-1: 저장소도 입력을 lower()로 맞춰, 호출자가 소문자화를 빠뜨려도 같은 계정을 찾는다.
    @Test
    void 로그인_조회는_입력_대소문자와_관계없이_같은_계정() {
        for (String id : new String[] {"runner01", "Runner01", "RUNNER01"}) {
            var found = authUsers.findByLoginId(id);
            assertThat(found).isPresent();
            assertThat(found.get().id()).isEqualTo(user);
            assertThat(found.get().loginId()).isEqualTo("runner01");
        }
        assertThat(authUsers.findByLoginId("Ghost01")).isEmpty();
    }

    // AC-9: 대소문자 조합을 바꿔도 같은 실패 키로 모여 5회에 잠긴다. 없는 아이디도 같다.
    @Test
    void 대소문자_조합으로_실패제한을_우회할_수_없다() throws Exception {
        String[] attempts = {"runner01", "runner01", "Runner01", "RUNNER01", "rUNNER01"};
        for (int i = 0; i < attempts.length; i++) {
            login(attempts[i], "Wrong999!")
                    .andExpect(status().is(i < 4 ? 401 : 429))
                    .andExpect(
                            jsonPath("$.code")
                                    .value(i < 4 ? "INVALID_CREDENTIALS" : "LOGIN_LOCKED"));
        }
        login("Runner01", "Runner9!")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("LOGIN_LOCKED"));
        assertThat(redis.keys("runway:auth:attempt:*"))
                .containsExactly("runway:auth:attempt:runner01");
        assertThat(LoginAttemptStore.key("RUNNER01")).isEqualTo("runway:auth:attempt:runner01");

        login("Ghost01", "Wrong999!").andExpect(status().isUnauthorized());
        login("ghost01", "Wrong999!").andExpect(status().isUnauthorized());
        assertThat(redis.opsForValue().get("runway:auth:attempt:ghost01")).startsWith("2:");
        assertThat(redis.hasKey("runway:auth:attempt:Ghost01")).isFalse();
    }

    // AC-10: 성공한 로그인은 대소문자와 관계없이 같은 키를 지우고 다음 실패는 1회부터다.
    @Test
    void 성공_초기화는_대소문자_무관() throws Exception {
        for (int i = 0; i < 3; i++) login("RUNNER01", "Wrong999!").andExpect(status().isUnauthorized());
        assertThat(redis.opsForValue().get("runway:auth:attempt:runner01")).startsWith("3:");
        login("Runner01", "Runner9!").andExpect(status().isOk());
        assertThat(redis.hasKey("runway:auth:attempt:runner01")).isFalse();
        login("rUnNeR01", "Wrong999!").andExpect(status().isUnauthorized());
        assertThat(redis.opsForValue().get("runway:auth:attempt:runner01")).startsWith("1:");
    }

    // AC-11 (1): 새 탈퇴는 소문자 아이디의 해시로 예약되고 대소문자와 관계없이 재사용할 수 없다.
    @Test
    void 탈퇴한_아이디는_대소문자와_관계없이_재사용할_수_없다() throws Exception {
        signup("Retired01", "탈퇴예정").andExpect(status().isCreated());
        long id =
                jdbc.queryForObject("SELECT id FROM users WHERE login_id='retired01'", Long.class);
        // U18 탈퇴와 같이 저장된(소문자) 아이디의 해시로 바꾼다(WithdrawalApiIntegrationTest가 실제 U18 경로를 확인).
        jdbc.update(
                "UPDATE users SET login_id=?,account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?",
                RetiredLoginId.digest("retired01"),
                id);
        for (String login : new String[] {"RETIRED01", "Retired01", "retired01"}) {
            signup(login, "새회원")
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("LOGIN_ID_DUPLICATED"));
            availability(login).andExpect(jsonPath("$.available").value(false));
        }
    }

    // AC-11 (2): 예전 탈퇴(원래 대소문자 해시)는 같은 대소문자로만 막힌다. 대소문자만 다른 재사용은 수용한 한계다(D-3).
    @Test
    void 예전_대소문자_해시는_같은_입력만_막고_다른_대소문자는_한계로_허용() throws Exception {
        jdbc.update(
                "UPDATE users SET login_id=?,account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?",
                RetiredLoginId.digest("Runner01"),
                user);
        assertThat(signupRepository.loginIdExists("Runner01")).isTrue();
        assertThat(signupRepository.loginIdExists("runner01")).isFalse();
        signup("Runner01", "새회원")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LOGIN_ID_DUPLICATED"));
        signup("runner01", "새회원").andExpect(status().isCreated());
    }

    // AC-4·AC-12: DB가 최종 판정한다. 제약 이름으로 409를 고르므로 이름을 확인한다.
    @Test
    void DB가_대소문자_무시_중복과_대문자_아이디를_거절한다() {
        String insert =
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access,
                    account_status,withdrawn_at)
                VALUES (?,'synthetic-hash',?,'2000-01-01','MALE','01083109999','DISAGREE',?::users_account_status_enum,?)
                """;
        jdbc.update(insert, "abcowner", "ABC12", "ACTIVE", null);
        assertViolation(
                () -> jdbc.update(insert, "otherid2", "abc12", "ACTIVE", null),
                "23505",
                "uq_users_nickname");
        assertViolation(
                () -> jdbc.update(insert, "runner01", "다른닉", "ACTIVE", null),
                "23505",
                "uq_users_login_id");
        assertViolation(
                () -> jdbc.update(insert, "RUNNER02", "다른닉", "ACTIVE", null),
                "23514",
                "ck_users_login_id_lower");
        // 탈퇴 회원은 닉네임 판정 대상이 아니다.
        jdbc.update(insert, RetiredLoginId.digest("gone01"), "abc12", "WITHDRAWN", java.time.OffsetDateTime.now());
        jdbc.update(insert, RetiredLoginId.digest("gone02"), "Abc12", "WITHDRAWN", java.time.OffsetDateTime.now());
    }

    // AC-14: 아이디·닉네임이 아닌 다른 무결성 오류는 중복 오류로 바꾸지 않는다(users.md U15).
    @Test
    void 다른_무결성_오류는_중복오류로_바꾸지_않는다() throws Exception {
        // 준비 회원과 같은 생년(2000-01-01)으로 가입하면 이 임시 인덱스만 어긴다. 끝나면 @AfterEach가 지운다.
        jdbc.execute("CREATE UNIQUE INDEX tmp_uq_users_birth_date ON users(birth_date)");
        signup("Distinct01", "별개회원")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("distinct01"))))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("별개회원"))));
        assertThat(users()).isEqualTo(1);
    }

    // AC-15: U30은 바뀌지 않는다. 대소문자만 다른 아이디와 같은 새 비밀번호는 거절, 재설정 뒤 대문자 입력으로 로그인된다.
    @Test
    void 비밀번호_재설정_회귀_없음() throws Exception {
        String phone = "01000000000";
        redis.delete(redis.keys("runway:auth:phone:wait:*"));
        assertThat(verifications.issue(PhoneVerificationPurpose.PASSWORD_RESET, phone, "198.51.100.84", "831832").status()).isEqualTo(1);
        assertThat(verifications.confirm(PhoneVerificationPurpose.PASSWORD_RESET, phone, "831832", "synthetic-reset-831").status()).isEqualTo(1);
        resetPassword("synthetic-reset-831", "RUNNER01")
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_PASSWORD_POLICY"));
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey("synthetic-reset-831"))).isTrue();
        resetPassword("synthetic-reset-831", "NewRunner9!").andExpect(status().isNoContent());
        login("RUNNER01", "NewRunner9!")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.loginId").value("runner01"));
    }

    private ResultActions resetPassword(String token, String password) throws Exception {
        return mvc.perform(
                post("/api/v1/auth/password-reset")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                mapper.writeValueAsString(
                                        Map.of("verificationToken", token, "newPassword", password))));
    }

    private static void assertViolation(Runnable action, String sqlState, String constraint) {
        Throwable thrown = catchThrowable(action::run);
        assertThat(thrown).isInstanceOf(DataIntegrityViolationException.class);
        Throwable root = thrown;
        while (root.getCause() != null) root = root.getCause();
        assertThat(root).isInstanceOf(SQLException.class);
        assertThat(((SQLException) root).getSQLState()).isEqualTo(sqlState);
        assertThat(root.getMessage()).contains("\"" + constraint + "\"");
    }
}
