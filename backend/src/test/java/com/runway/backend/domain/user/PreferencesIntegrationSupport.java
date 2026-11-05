package com.runway.backend.domain.user;

import com.runway.backend.domain.user.model.PreferenceSelection;
import com.runway.backend.domain.user.service.PreferencesService;
import com.runway.backend.domain.user.validation.PreferencesValidator;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

@SpringBootTest
@AutoConfigureMockMvc
abstract class PreferencesIntegrationSupport {
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(PreferencesIntegrationSupport.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.security.jwt-secret-base64", () -> SecurityTestSupport.KEY);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper mapper;
    @Autowired PreferencesService service;
    @Autowired PreferencesValidator validator;
    long user;
    long other;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM user_profiles");
        jdbc.update("DELETE FROM users");
        user = member("prefone");
        other = member("preftwo");
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

    ObjectNode body(String shape, boolean flag) {
        var root = mapper.createObjectNode();
        root.put("shape", shape);
        var filters = root.putObject("filters");
        for (String key : PreferenceSelection.FILTERS) filters.put(key, flag);
        return root;
    }

    PreferenceSelection selection(String shape, boolean flag) {
        return validator.validate(
                com.runway.backend.domain.user.dto.request.PreferencesRequest.from(
                        body(shape, flag)));
    }

    int count() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM user_recommendation_preferences", Integer.class);
    }
}
