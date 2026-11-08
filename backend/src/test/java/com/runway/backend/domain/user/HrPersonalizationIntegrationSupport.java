package com.runway.backend.domain.user;

import com.runway.backend.domain.user.model.HrPersonalizationCommand;
import com.runway.backend.domain.user.service.HrPersonalizationService;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;

@SpringBootTest
abstract class HrPersonalizationIntegrationSupport {
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(HrPersonalizationIntegrationSupport.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.security.jwt-secret-base64", () -> SecurityTestSupport.KEY);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper mapper;
    @Autowired HrPersonalizationService service;

    long user;
    long other;

    @BeforeEach
    void seed() {
        // user_hr_personalization은 users 삭제 시 ON DELETE CASCADE로 함께 지워진다.
        jdbc.update("DELETE FROM user_profiles");
        jdbc.update("DELETE FROM users");
        // 저장 서비스는 건강정보 동의를 검사하지 않으므로 DISAGREE 회원으로도 저장된다.
        user = member("hrpersone");
        other = member("hrperstwo");
    }

    long member(String name) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'synthetic-hash', ?, '2000-01-01', 'MALE', '00000000000', 'DISAGREE')
                RETURNING id
                """,
                Long.class,
                name,
                name);
    }

    /** 모든 HR 값이 채워진 합성 Command. */
    HrPersonalizationCommand command() {
        return command("model-synthetic-1", 7);
    }

    HrPersonalizationCommand command(String modelVersion, int supportRunCount) {
        return new HrPersonalizationCommand(
                "hr-personalization-v1",
                modelVersion,
                supportRunCount,
                "{\"u\":[0.1,0.2,0.3],\"label\":\"summary\"}",
                "[1,2,3,4,5,6,7,8]",
                "[0.5,-0.5,1.5,2.5]",
                new BigDecimal("85.50"),
                new BigDecimal("140.25"),
                new BigDecimal("172.40"),
                new BigDecimal("158.10"),
                12);
    }

    /** 선택 HR·임계 값이 모두 없는 Command. hr0SubBpm만 필수다. */
    HrPersonalizationCommand commandWithoutOptionals() {
        return new HrPersonalizationCommand(
                "hr-personalization-v1",
                "model-synthetic-1",
                0,
                "{\"u\":[]}",
                "[0,0,0,0,0,0,0,0]",
                "[0,0,0,0]",
                new BigDecimal("85"),
                null,
                null,
                null,
                null);
    }

    int count(long userId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM user_hr_personalization WHERE user_id=?",
                Integer.class,
                userId);
    }
}
