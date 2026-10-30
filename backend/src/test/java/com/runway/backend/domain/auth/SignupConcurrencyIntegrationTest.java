package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.runway.backend.domain.auth.repository.SignupRepository;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import tools.jackson.databind.json.JsonMapper;

import java.util.concurrent.*;

class SignupConcurrencyIntegrationTest extends AuthIntegrationSupport {
    @MockitoSpyBean SignupRepository repository;
    @Autowired JsonMapper mapper;

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void sameIdOrNicknameHasExactlyOneWinner(boolean sameNickname) throws Exception {
        var barrier = new CyclicBarrier(2);
        doAnswer(
                        call -> {
                            barrier.await(10, TimeUnit.SECONDS);
                            return call.callRealMethod();
                        })
                .when(repository)
                .insertUser(any(), anyString());
        String[] json = {
            mapper.writeValueAsString(SignupValidationTest.payload("racer001", "경합하나", false)),
            mapper.writeValueAsString(
                    SignupValidationTest.payload(
                            sameNickname ? "racer002" : "racer001",
                            sameNickname ? "경합하나" : "경합둘째",
                            true))
        };
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> send(json[0]));
            var second = executor.submit(() -> send(json[1]));
            var responses =
                    java.util.List.of(
                            first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
            assertThat(responses.stream().map(r -> r.getStatus()))
                    .containsExactlyInAnyOrder(201, 409);
            var loser =
                    responses.stream().filter(r -> r.getStatus() == 409).findFirst().orElseThrow();
            assertThat(mapper.readTree(loser.getContentAsString()).get("code").asString())
                    .isEqualTo(sameNickname ? "NICKNAME_DUPLICATED" : "LOGIN_ID_DUPLICATED");
            assertThat(loser.getContentAsString())
                    .doesNotContain("accessToken", "refreshToken", "Runner9!");
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM users WHERE login_id LIKE 'racer%'",
                                Integer.class))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_settings", Integer.class))
                .isEqualTo(1);
        assertThat(redis.keys("runway:auth:family:*")).hasSize(1);
    }

    private org.springframework.mock.web.MockHttpServletResponse send(String json)
            throws Exception {
        return mvc.perform(
                        post("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json))
                .andReturn()
                .getResponse();
    }
}
