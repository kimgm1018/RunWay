package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.config.SignupSettings;
import com.runway.backend.domain.auth.repository.PhoneVerificationStore;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.auth.verification.PhoneVerificationPurpose;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** users.md U15 휴대전화 인증(S15P31E105-560) AC-5·AC-6·AC-15·AC-18. */
class SignupVerificationIntegrationTest extends AuthIntegrationSupport {
    private static final String PHONE = "01055556666";

    @Autowired JsonMapper mapper;
    @Autowired SignupSettings settings;
    @Autowired PhoneVerificationStore verifications;
    @Autowired SignupRepository signupRepository;

    @AfterEach
    void restoreTestDefault() {
        settings.setUnverifiedPhoneAllowed(true);
    }

    /** 인증번호 요청·확인을 저장소로 직접 거쳐 증명을 만든다(문자 발송은 U28 테스트에서 확인). */
    private String proof(PhoneVerificationPurpose purpose, String phone, String token) {
        redis.delete(redis.keys("runway:auth:phone:wait:*"));
        assertThat(verifications.issue(purpose, phone, "198.51.100.40", "123456").status()).isEqualTo(1);
        assertThat(verifications.confirm(purpose, phone, "123456", token).status()).isEqualTo(1);
        return token;
    }

    private ResultActions signup(String login, String nickname, String phone, Object token)
            throws Exception {
        Map<String, Object> body = SignupValidationTest.payload(login, nickname, false);
        body.put("phoneNumber", phone);
        if (token != null) body.put("phoneVerificationToken", token);
        return mvc.perform(post("/api/v1/auth/signup")
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)));
    }

    private int activeUsers(String phone) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE phone_number=? AND account_status='ACTIVE'",
                Integer.class, phone);
    }

    @Test
    void 운영_설정에서는_증명_없이_가입할_수_없다() throws Exception {
        settings.setUnverifiedPhoneAllowed(false);
        signup("newrunner", "새러너", PHONE, null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(activeUsers(PHONE)).isZero();
    }

    @Test
    void 유효한_증명으로_가입하고_같은_증명은_다시_쓸_수_없다() throws Exception {
        settings.setUnverifiedPhoneAllowed(false);
        String token = proof(PhoneVerificationPurpose.SIGN_UP, PHONE, "synthetic-proof-1");
        signup("newrunner", "새러너", PHONE, token).andExpect(status().isCreated());
        assertThat(activeUsers(PHONE)).isEqualTo(1);
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isFalse();

        signup("another1", "다른러너", "01077778888", token)
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("VERIFICATION_EXPIRED"));
        assertThat(activeUsers("01077778888")).isZero();
    }

    @Test
    void 증명이_번호나_목적과_다르면_410이고_형식이_틀리면_400이다() throws Exception {
        settings.setUnverifiedPhoneAllowed(false);
        String other = proof(PhoneVerificationPurpose.SIGN_UP, "01077778888", "synthetic-proof-2");
        signup("newrunner", "새러너", PHONE, other).andExpect(status().isGone());
        jdbc.update("UPDATE users SET phone_number=? WHERE id=?", PHONE, user);
        String reset = proof(PhoneVerificationPurpose.PASSWORD_RESET, PHONE, "synthetic-proof-3");
        jdbc.update("UPDATE users SET phone_number='01000000000' WHERE id=?", user);
        signup("newrunner", "새러너", PHONE, reset).andExpect(status().isGone());
        signup("newrunner", "새러너", PHONE, "never-issued").andExpect(status().isGone());
        signup("newrunner", "새러너", PHONE, 12345)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(activeUsers(PHONE)).isZero();
    }

    @Test
    void 증명이_틀리면_가입된_번호여도_410이라_가입_여부를_알_수_없다() throws Exception {
        // 리뷰 R-1: 번호 중복 판정을 증명 확인 뒤로 옮겼다.
        settings.setUnverifiedPhoneAllowed(false);
        signup("newrunner", "새러너", "01000000000", "x")
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("VERIFICATION_EXPIRED"));
        signup("newrunner", "새러너", PHONE, "x")
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("VERIFICATION_EXPIRED"));
    }

    @Test
    void 증명_발급_뒤_그_번호가_가입되면_409이고_증명은_소비된다() throws Exception {
        settings.setUnverifiedPhoneAllowed(false);
        String token = proof(PhoneVerificationPurpose.SIGN_UP, "01000000000", "synthetic-proof-4");
        signup("newrunner", "새러너", "01000000000", token)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PHONE_ALREADY_REGISTERED"));
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isFalse();
        // 증명 없는 개발·테스트 설정에서도 번호 중복은 거절한다.
        settings.setUnverifiedPhoneAllowed(true);
        signup("newrunner", "새러너", "01000000000", null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PHONE_ALREADY_REGISTERED"));
    }

    @Test
    void 같은_번호로_동시에_가입해도_계정은_하나다() throws Exception {
        // 사전 확인은 둘 다 통과한다. 회원을 넣은 뒤(커밋 전) 서로를 최대 1초 기다려, 잠금이 없으면 두 트랜잭션이 상대의 커밋 전에
        // 번호 확인을 하게 만든다. 잠금이 있으면 두 번째는 잠금에서 기다리므로 첫 번째의 대기는 시간 초과로 끝나고 순서대로 진행한다.
        var inserted = new CyclicBarrier(2);
        doAnswer(invocation -> {
                    Object id = invocation.callRealMethod();
                    try {
                        inserted.await(1, java.util.concurrent.TimeUnit.SECONDS);
                    } catch (java.util.concurrent.TimeoutException
                            | java.util.concurrent.BrokenBarrierException ignored) {
                        // 잠금으로 순서가 정해진 경우
                    }
                    return id;
                })
                .when(signupRepository)
                .insertUser(any(), any());
        var barrier = new CyclicBarrier(2);
        Callable<int[]> first = () -> {
            barrier.await();
            return new int[] {signup("racer001", "경주1", PHONE, null).andReturn().getResponse().getStatus()};
        };
        Callable<int[]> second = () -> {
            barrier.await();
            return new int[] {signup("racer002", "경주2", PHONE, null).andReturn().getResponse().getStatus()};
        };
        List<Integer> statuses = new ArrayList<>();
        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Future<int[]>> results = List.of(executor.submit(first), executor.submit(second));
            for (var result : results) statuses.add(result.get()[0]);
        }
        assertThat(statuses).containsExactlyInAnyOrder(201, 409);
        assertThat(activeUsers(PHONE)).isEqualTo(1);
    }

    @Test
    void 같은_증명으로_동시에_가입하면_한_건만_성공한다() throws Exception {
        // AC-5(리뷰 R-4): 두 요청이 증명 소비에 함께 도착하게 맞춘다. 소비가 원자적이지 않으면 둘 다 증명을 얻어 410이 나오지 않는다.
        settings.setUnverifiedPhoneAllowed(false);
        String token = proof(PhoneVerificationPurpose.SIGN_UP, PHONE, "synthetic-proof-6");
        var atConsume = new CyclicBarrier(2);
        doAnswer(invocation -> {
                    try {
                        atConsume.await(2, java.util.concurrent.TimeUnit.SECONDS);
                    } catch (java.util.concurrent.TimeoutException
                            | java.util.concurrent.BrokenBarrierException ignored) {
                        // 한쪽이 먼저 끝난 경우
                    }
                    return invocation.callRealMethod();
                })
                .when(verifications)
                .consume(anyString());
        var barrier = new CyclicBarrier(2);
        Callable<Integer> first = () -> {
            barrier.await();
            return signup("racer001", "경주1", PHONE, token).andReturn().getResponse().getStatus();
        };
        Callable<Integer> second = () -> {
            barrier.await();
            return signup("racer002", "경주2", PHONE, token).andReturn().getResponse().getStatus();
        };
        List<Integer> statuses = new ArrayList<>();
        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> results = List.of(executor.submit(first), executor.submit(second));
            for (var result : results) statuses.add(result.get());
        }
        assertThat(statuses).containsExactlyInAnyOrder(201, 410);
        assertThat(activeUsers(PHONE)).isEqualTo(1);
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isFalse();
    }

    @Test
    void 증명을_소비한_뒤_저장이_실패하면_증명은_되살리지_않는다() throws Exception {
        settings.setUnverifiedPhoneAllowed(false);
        String token = proof(PhoneVerificationPurpose.SIGN_UP, PHONE, "synthetic-proof-5");
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic"))
                .when(signupRepository)
                .insertSettings(anyLong());
        signup("newrunner", "새러너", PHONE, token)
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
        assertThat(activeUsers(PHONE)).isZero();
        assertThat(redis.hasKey(PhoneVerificationStore.proofKey(token))).isFalse();
    }
}
