package com.runway.backend.domain.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.notification.service.PushTokenService;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** N03/N04 device push token registration (S15P31E105-815, AC-6·AC-7). */
@SpringBootTest
@AutoConfigureMockMvc
class PushTokenApiIntegrationTest {
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(PushTokenApiIntegrationTest.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.security.jwt-secret-base64", () -> SecurityTestSupport.KEY);
    }

    static final String PATH = "/api/v1/notifications/push-tokens";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired SignupRepository signup;
    @Autowired PushTokenService service;

    long alice;
    long bob;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE users RESTART IDENTITY CASCADE");
        alice = member("palice");
        bob = member("pbob");
    }

    long member(String name) {
        long id =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES (?, 'synthetic', ?, '2000-01-01', 'MALE', '00000000000', 'DISAGREE')
                        RETURNING id
                        """,
                        Long.class,
                        name,
                        name);
        signup.insertSettings(id);
        return id;
    }

    ResultActions register(long userId, String body) throws Exception {
        return mvc.perform(
                put(PATH)
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    ResultActions register(long userId, String token, String platform) throws Exception {
        return register(
                userId, "{\"token\":\"" + token + "\",\"platform\":\"" + platform + "\"}");
    }

    ResultActions unregister(long userId, String token) throws Exception {
        return mvc.perform(
                delete(PATH)
                        .header("Authorization", SecurityTestSupport.bearer(userId))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + token + "\"}"));
    }

    List<String> tokensOf(long userId) {
        return jdbc.queryForList(
                "SELECT token FROM push_device_tokens WHERE user_id=? ORDER BY token",
                String.class,
                userId);
    }

    @Test
    void registerStoresTokenAndReRegisterKeepsSingleRow() throws Exception {
        register(alice, "fcm-token:A_1", "ANDROID").andExpect(status().isNoContent());
        register(alice, "fcm-token:A_1", "ANDROID").andExpect(status().isNoContent());
        assertThat(tokensOf(alice)).containsExactly("fcm-token:A_1");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM push_device_tokens", Long.class))
                .isEqualTo(1);
    }

    @Test
    void sameDeviceSignedInToAnotherAccountMovesTokenOwner() throws Exception {
        register(alice, "shared-device", "ANDROID").andExpect(status().isNoContent());
        register(bob, "shared-device", "ANDROID").andExpect(status().isNoContent());
        assertThat(tokensOf(alice)).isEmpty();
        assertThat(tokensOf(bob)).containsExactly("shared-device");
    }

    @Test
    void deleteRemovesOnlyOwnTokenAndIsIdempotent() throws Exception {
        register(alice, "alice-device", "ANDROID").andExpect(status().isNoContent());
        register(bob, "bob-device", "ANDROID").andExpect(status().isNoContent());

        unregister(alice, "bob-device").andExpect(status().isNoContent());
        assertThat(tokensOf(bob)).containsExactly("bob-device");

        unregister(alice, "alice-device").andExpect(status().isNoContent());
        unregister(alice, "alice-device").andExpect(status().isNoContent());
        unregister(alice, "never-registered").andExpect(status().isNoContent());
        assertThat(tokensOf(alice)).isEmpty();
    }

    @Test
    void eleventhTokenDropsLeastRecentlyRegistered() throws Exception {
        for (int i = 0; i < 10; i++) {
            register(alice, "device-" + i, "ANDROID").andExpect(status().isNoContent());
            jdbc.update(
                    "UPDATE push_device_tokens SET updated_at=now() - make_interval(mins => ?) WHERE token=?",
                    100 - i,
                    "device-" + i);
        }
        register(alice, "device-new", "ANDROID").andExpect(status().isNoContent());
        var tokens = tokensOf(alice);
        assertThat(tokens).hasSize(10).contains("device-new").doesNotContain("device-0");
    }

    @Test
    void reRegisteringRefreshesRecencySoItIsNotTrimmed() throws Exception {
        for (int i = 0; i < 10; i++) {
            register(alice, "device-" + i, "ANDROID").andExpect(status().isNoContent());
            jdbc.update(
                    "UPDATE push_device_tokens SET updated_at=now() - make_interval(mins => ?) WHERE token=?",
                    100 - i,
                    "device-" + i);
        }
        register(alice, "device-0", "ANDROID").andExpect(status().isNoContent());
        register(alice, "device-new", "ANDROID").andExpect(status().isNoContent());
        assertThat(tokensOf(alice)).hasSize(10).contains("device-0").doesNotContain("device-1");
    }

    @Test
    void invalidBodiesAreRejectedWithoutStoring() throws Exception {
        register(alice, "", "ANDROID").andExpect(status().isBadRequest());
        register(alice, "x".repeat(513), "ANDROID").andExpect(status().isBadRequest());
        register(alice, "has space", "ANDROID").andExpect(status().isBadRequest());
        register(alice, "ok-token", "IOS").andExpect(status().isBadRequest());
        register(alice, "{\"token\":\"ok-token\"}").andExpect(status().isBadRequest());
        register(alice, "not json").andExpect(status().isBadRequest());
        unregister(alice, "").andExpect(status().isBadRequest());
        register(alice, "x".repeat(512), "ANDROID").andExpect(status().isNoContent());
        assertThat(tokensOf(alice)).containsExactly("x".repeat(512));
    }

    @Test
    void invalidBodyUsesValidationErrorCode() throws Exception {
        register(alice, "", "ANDROID")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void withdrawnMemberWithLeftoverJwtCannotRegister() throws Exception {
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", alice);
        register(alice, "after-withdrawal", "ANDROID").andExpect(status().isUnauthorized());
        assertThat(tokensOf(alice)).isEmpty();
    }

    @Test
    void anonymousIsRejected() throws Exception {
        mvc.perform(
                        put(PATH)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"token\":\"t\",\"platform\":\"ANDROID\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(delete(PATH).contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"t\"}"))
                .andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM push_device_tokens", Long.class))
                .isZero();
    }

    @Test
    void concurrentRegistrationsOfSameTokenLeaveOneRow() throws Exception {
        int callers = 8;
        var ready = new CountDownLatch(callers);
        var go = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(callers);
        try {
            List<Future<Void>> results = new ArrayList<>();
            for (int i = 0; i < callers; i++) {
                long owner = i % 2 == 0 ? alice : bob;
                Callable<Void> call =
                        () -> {
                            ready.countDown();
                            go.await();
                            service.register(owner, "race-token", "ANDROID");
                            return null;
                        };
                results.add(pool.submit(call));
            }
            ready.await();
            go.countDown();
            for (var result : results) {
                result.get();
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM push_device_tokens WHERE token='race-token'",
                                Long.class))
                .isEqualTo(1);
    }
}
