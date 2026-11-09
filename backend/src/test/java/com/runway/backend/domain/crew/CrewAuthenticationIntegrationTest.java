package com.runway.backend.domain.crew;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

class CrewAuthenticationIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    long first;
    long second;

    @BeforeEach
    void seed() {
        first = seedUser(jdbc, "first");
        second = seedUser(jdbc, "second");
    }

    static long seedUser(JdbcTemplate jdbc, String name) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'synthetic-hash', ?, '2000-01-01', 'MALE', '01000000000', 'AGREE') RETURNING id
                """,
                Long.class,
                name,
                name);
    }

    @Test
    void 인증실패_헤더가장과_잘못된입력은_DB를_쓰지않는다() throws Exception {
        String valid = SecurityTestSupport.bearer(first);
        String tampered = valid.substring(0, valid.lastIndexOf('.') + 1) + "invalid-signature";
        String expired = "Bearer " + AuthenticationAccountPolicyTest.expiredToken(first);
        for (String value : List.of("", "Bearer invalid", tampered, expired)) {
            mvc.perform(
                            post("/api/v1/crews")
                                    .header("Authorization", value)
                                    .header("X-User-Id", first)
                                    .contentType("application/json")
                                    .content("broken-json"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        }
        mvc.perform(
                        post("/api/v1/crews")
                                .header("X-User-Id", first)
                                .contentType("application/json")
                                .content("{\"name\":\"crew\",\"capacity\":10}"))
                .andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM crews", Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM crew_memberships", Long.class))
                .isZero();
    }

    @Test
    void 토큰과_상충헤더는_토큰사용자로만_저장하고_관리자권한을_유지한다() throws Exception {
        mvc.perform(
                        post("/api/v1/crews")
                                .header("Authorization", SecurityTestSupport.bearer(first))
                                .header("X-User-Id", second)
                                .contentType("application/json")
                                .content("{\"name\":\"authenticated crew\",\"capacity\":10}"))
                .andExpect(status().isCreated());
        long crew = jdbc.queryForObject("SELECT id FROM crews", Long.class);
        assertThat(jdbc.queryForObject("SELECT owner_id FROM crews", Long.class)).isEqualTo(first);
        mvc.perform(
                        get("/api/v1/crews/" + crew + "/join-requests")
                                .header("Authorization", SecurityTestSupport.bearer(second))
                                .header("X-User-Id", first))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_ADMIN"));
        mvc.perform(
                        get("/api/v1/users/me/crews")
                                .header("Authorization", SecurityTestSupport.bearer(second))
                                .header("X-User-Id", first))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }
}
