package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.PhoneAccountRepository;
import com.runway.backend.domain.auth.repository.PhoneVerificationStore;
import com.runway.backend.domain.auth.verification.PhoneVerificationPurpose;
import com.runway.backend.domain.auth.verification.SmsPort;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** users.md U28·U29(S15P31E105-560) AC-1~AC-5, AC-9~AC-11. 실제 SMS 대신 SmsPort Mock을 쓴다. */
@ExtendWith(OutputCaptureExtension.class)
class PhoneVerificationIntegrationTest extends AuthIntegrationSupport {
    private static final String PHONE = "01012345678";
    private static final Pattern CODE = Pattern.compile("\\[(\\d{6})]");

    @Autowired SmsPort sms;
    @Autowired PhoneVerificationStore store;
    @Autowired PhoneAccountRepository phoneAccounts;

    @BeforeEach
    void smsOn() {
        when(sms.enabled()).thenReturn(true);
        when(sms.send(anyString(), anyString())).thenReturn(SmsPort.Result.ACCEPTED);
    }

    private ResultActions request(String phone, String purpose, String ip) throws Exception {
        return mvc.perform(
                post("/api/v1/auth/phone-verifications")
                        .with(r -> { r.setRemoteAddr(ip); return r; })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phoneNumber\":\"" + phone + "\",\"purpose\":\"" + purpose + "\"}"));
    }

    private ResultActions request(String phone, String purpose) throws Exception {
        return request(phone, purpose, "198.51.100.7");
    }

    private ResultActions confirm(String phone, String purpose, String code) throws Exception {
        return mvc.perform(
                post("/api/v1/auth/phone-verifications/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phoneNumber\":\"" + phone + "\",\"purpose\":\"" + purpose
                                + "\",\"code\":\"" + code + "\"}"));
    }

    /** 가장 최근에 보낸 문자에서 인증번호를 꺼낸다. */
    private String lastCode() {
        var text = ArgumentCaptor.forClass(String.class);
        verify(sms, atLeastOnce()).send(anyString(), text.capture());
        Matcher matcher = CODE.matcher(text.getValue());
        assertThat(matcher.find()).isTrue();
        return matcher.group(1);
    }

    private static String wrong(String code) {
        return code.equals("000000") ? "111111" : "000000";
    }

    private void clearResendWait() {
        var keys = redis.keys("runway:auth:phone:wait:*");
        if (keys != null && !keys.isEmpty()) redis.delete(keys);
    }

    @Test
    void 요청하면_문자를_한_번_보내고_확인하면_일회용_증명을_준다(CapturedOutput output) throws Exception {
        request(PHONE, "SIGN_UP")
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.expiresInSec").value(180))
                .andExpect(jsonPath("$.resendAvailableInSec").value(60));
        var to = ArgumentCaptor.forClass(String.class);
        var text = ArgumentCaptor.forClass(String.class);
        verify(sms, times(1)).send(to.capture(), text.capture());
        assertThat(to.getValue()).isEqualTo(PHONE);
        assertThat(text.getValue()).matches("\\[Runway] 본인확인 인증번호 \\[\\d{6}]");
        String code = lastCode();
        String key = PhoneVerificationStore.codeKeyFor(PhoneVerificationPurpose.SIGN_UP, PHONE);
        assertThat(redis.getExpire(key)).isBetween(1L, 180L);

        var body = confirm(PHONE, "SIGN_UP", code)
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.expiresInSec").value(600))
                .andReturn().getResponse().getContentAsString();
        String token = body.replaceAll(".*\"verificationToken\":\"([^\"]+)\".*", "$1");
        assertThat(token).matches("[A-Za-z0-9_-]{43}");
        assertThat(redis.hasKey(key)).isFalse();
        assertThat(redis.getExpire(PhoneVerificationStore.proofKey(token))).isBetween(1L, 600L);
        confirm(PHONE, "SIGN_UP", code)
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("VERIFICATION_EXPIRED"));

        // 키에 전화번호 원문이 없고, 로그·응답에 번호·인증번호·증명이 없다.
        assertThat(redis.keys("runway:auth:phone:*")).allSatisfy(k -> assertThat(k).doesNotContain(PHONE));
        assertThat(output.getAll()).doesNotContain(PHONE).doesNotContain(code).doesNotContain(token);

        var proof = store.consume(token);
        assertThat(proof).isPresent();
        assertThat(proof.get().purpose()).isEqualTo(PhoneVerificationPurpose.SIGN_UP);
        assertThat(proof.get().phoneNumber()).isEqualTo(PHONE);
        assertThat(store.consume(token)).isEmpty();
    }

    /** 요청부터 확인까지 진행해 확인 응답을 돌려준다. 재발송 대기는 매번 비운다. */
    private ResultActions requestAndConfirm(String phone, String purpose) throws Exception {
        clearResendWait();
        request(phone, purpose).andExpect(status().isOk());
        return confirm(phone, purpose, lastCode());
    }

    @Test
    void 요청은_가입_여부와_관계없이_같은_응답으로_보낸다() throws Exception {
        // 리뷰 R-1: 휴대전화가 없는 사람이 U28 응답으로 가입 여부를 구분할 수 없어야 한다.
        request("01000000000", "SIGN_UP").andExpect(status().isOk());
        request(PHONE, "PASSWORD_RESET").andExpect(status().isOk());
        verify(sms, times(2)).send(anyString(), anyString());
    }

    @Test
    void 가입_여부는_인증번호를_맞힌_뒤에만_알려_주고_증명을_주지_않는다() throws Exception {
        requestAndConfirm("01000000000", "SIGN_UP")
                .andExpect(status().isConflict())
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
                .andExpect(jsonPath("$.code").value("PHONE_ALREADY_REGISTERED"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("0100000"))));
        requestAndConfirm(PHONE, "PASSWORD_RESET")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PHONE_NOT_REGISTERED"));
        jdbc.update("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('runner02',?,'러너2','2000-01-01','MALE','01000000000','DISAGREE')
                """, encoded);
        requestAndConfirm("01000000000", "PASSWORD_RESET")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PHONE_ACCOUNT_AMBIGUOUS"));
        // 증명은 남지 않고, 맞힌 인증번호도 다시 쓸 수 없다.
        assertThat(redis.keys("runway:auth:phone:proof:*")).isEmpty();
        assertThat(redis.hasKey(PhoneVerificationStore.codeKeyFor(PhoneVerificationPurpose.PASSWORD_RESET, "01000000000"))).isFalse();

        // 틀린 인증번호로는 가입 여부를 알 수 없다(일반 오입력 응답).
        clearResendWait();
        request("01000000000", "SIGN_UP").andExpect(status().isOk());
        confirm("01000000000", "SIGN_UP", wrong(lastCode()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VERIFICATION_CODE_MISMATCH"));

        jdbc.update("UPDATE users SET account_status='WITHDRAWN' WHERE login_id='runner02'");
        requestAndConfirm("01000000000", "PASSWORD_RESET").andExpect(status().isOk());
    }

    @Test
    void 가입_여부를_확인하지_못하면_증명을_지우고_503이다() throws Exception {
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic"))
                .when(phoneAccounts).activeUserIds(anyString());
        requestAndConfirm(PHONE, "SIGN_UP")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
        assertThat(redis.keys("runway:auth:phone:proof:*")).isEmpty();
    }

    @Test
    void 재발송은_60초_뒤이고_새_인증번호가_이전_것을_대신한다() throws Exception {
        request(PHONE, "SIGN_UP").andExpect(status().isOk());
        String first = lastCode();
        request(PHONE, "SIGN_UP")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("VERIFICATION_RESEND_TOO_SOON"))
                .andExpect(jsonPath("$.details.retryAfterSec").value(org.hamcrest.Matchers.allOf(org.hamcrest.Matchers.greaterThan(0), org.hamcrest.Matchers.lessThanOrEqualTo(60))));
        verify(sms, times(1)).send(anyString(), anyString());
        // 다른 목적은 따로 센다.
        jdbc.update("UPDATE users SET phone_number=? WHERE id=?", PHONE, user);
        request(PHONE, "PASSWORD_RESET").andExpect(status().isOk());

        clearResendWait();
        jdbc.update("UPDATE users SET phone_number='01000000000' WHERE id=?", user);
        request(PHONE, "SIGN_UP").andExpect(status().isOk());
        String second = lastCode();
        if (!second.equals(first)) {
            confirm(PHONE, "SIGN_UP", first)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VERIFICATION_CODE_MISMATCH"));
        }
        confirm(PHONE, "SIGN_UP", second).andExpect(status().isOk());
    }

    @Test
    void 번호는_24시간_5회_IP는_100회까지다() throws Exception {
        for (int i = 0; i < 5; i++) {
            request(PHONE, "SIGN_UP").andExpect(status().isOk());
            clearResendWait();
        }
        request(PHONE, "SIGN_UP")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("VERIFICATION_SEND_LIMIT_EXCEEDED"))
                .andExpect(jsonPath("$.details.retryAfterSec").value(org.hamcrest.Matchers.allOf(org.hamcrest.Matchers.greaterThan(0), org.hamcrest.Matchers.lessThanOrEqualTo(86400))));
        verify(sms, times(5)).send(anyString(), anyString());

        // S15P31E105-799: 같은 사무실 네트워크처럼 IP 하나를 여럿이 쓰면 20회가 금방 찼다. IP 한도는 100회(99·100번째 성공, 101번째 429).
        String ip = "203.0.113.9";
        for (int i = 0; i < 100; i++) {
            request("0102000%04d".formatted(i), "SIGN_UP", ip).andExpect(status().isOk());
        }
        request("01020009999", "SIGN_UP", ip)
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("VERIFICATION_SEND_LIMIT_EXCEEDED"));
        verify(sms, times(105)).send(anyString(), anyString());
        // 거절된 101번째는 집계에 남지 않는다(리뷰 A-1).
        assertThat(redis.opsForZSet().zCard(redisIpKey(ip))).isEqualTo(100L);
        // 형식 오류는 한도에 세지 않는다. 가입된 번호도 같은 한도를 쓴다(가입 여부를 묻지 않으므로).
        request("010-0000-0000", "SIGN_UP", "203.0.113.10").andExpect(status().isBadRequest());
        assertThat(redis.hasKey(redisIpKey("203.0.113.10"))).isFalse();
        request("01000000000", "SIGN_UP", "203.0.113.10").andExpect(status().isOk());
        assertThat(redis.hasKey(redisIpKey("203.0.113.10"))).isTrue();
    }

    private static String redisIpKey(String ip) throws Exception {
        var digest = java.security.MessageDigest.getInstance("SHA-256")
                .digest(ip.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return "runway:auth:phone:ip:" + java.util.HexFormat.of().formatHex(digest);
    }

    @Test
    void 다섯_번째_오입력에서_인증번호가_무효가_된다() throws Exception {
        request(PHONE, "SIGN_UP").andExpect(status().isOk());
        String code = lastCode();
        for (int failure = 1; failure <= 4; failure++) {
            confirm(PHONE, "SIGN_UP", wrong(code))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VERIFICATION_CODE_MISMATCH"))
                    .andExpect(jsonPath("$.details.failedCount").value(failure))
                    .andExpect(jsonPath("$.details.maxAttempts").value(5));
        }
        confirm(PHONE, "SIGN_UP", wrong(code))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("VERIFICATION_ATTEMPTS_EXCEEDED"))
                .andExpect(jsonPath("$.details.failedCount").value(5));
        confirm(PHONE, "SIGN_UP", code).andExpect(status().isGone());
    }

    @Test
    void 목적이_다르거나_시간이_지나면_410이다() throws Exception {
        request(PHONE, "SIGN_UP").andExpect(status().isOk());
        String code = lastCode();
        confirm(PHONE, "PASSWORD_RESET", code).andExpect(status().isGone());
        confirm("01099998888", "SIGN_UP", code).andExpect(status().isGone());

        String key = PhoneVerificationStore.codeKeyFor(PhoneVerificationPurpose.SIGN_UP, PHONE);
        String value = redis.opsForValue().get(key);
        // 저장된 만료 시각을 과거로 바꾸고 키 TTL은 남긴다(서버 시간 기준 만료 판정).
        redis.opsForValue().set(key, value.replaceAll(":\\d+$", ":1000"), java.time.Duration.ofSeconds(30));
        confirm(PHONE, "SIGN_UP", code)
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("VERIFICATION_EXPIRED"));
        assertThat(redis.hasKey(key)).isFalse();
    }

    @Test
    void 같은_인증번호를_동시에_확인해도_증명은_하나다() throws Exception {
        request(PHONE, "SIGN_UP").andExpect(status().isOk());
        String code = lastCode();
        var barrier = new CyclicBarrier(2);
        Callable<Integer> attempt = () -> {
            barrier.await();
            return confirm(PHONE, "SIGN_UP", code).andReturn().getResponse().getStatus();
        };
        try (var executor = Executors.newFixedThreadPool(2)) {
            List<Future<Integer>> results = new ArrayList<>();
            results.add(executor.submit(attempt));
            results.add(executor.submit(attempt));
            List<Integer> statuses = new ArrayList<>();
            for (var result : results) statuses.add(result.get());
            assertThat(statuses).containsExactlyInAnyOrder(200, 410);
        }
        assertThat(redis.keys("runway:auth:phone:proof:*")).hasSize(1);
    }

    @Test
    void 공급자가_거절하면_인증번호를_지우고_결과를_모르면_남긴다() throws Exception {
        String key = PhoneVerificationStore.codeKeyFor(PhoneVerificationPurpose.SIGN_UP, PHONE);
        when(sms.send(anyString(), anyString())).thenReturn(SmsPort.Result.REJECTED);
        request(PHONE, "SIGN_UP")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SMS_UNAVAILABLE"));
        assertThat(redis.hasKey(key)).isFalse();

        clearResendWait();
        when(sms.send(anyString(), anyString())).thenReturn(SmsPort.Result.UNKNOWN);
        request(PHONE, "SIGN_UP")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SMS_UNAVAILABLE"));
        assertThat(redis.hasKey(key)).isTrue();
        // 결과를 몰라도 다시 보내지 않는다.
        verify(sms, times(2)).send(anyString(), anyString());
        confirm(PHONE, "SIGN_UP", lastCode()).andExpect(status().isOk());
    }

    @Test
    void 인증_상태_저장소가_응답하지_않으면_503이고_문자를_보내지_않는다() throws Exception {
        // AC-9(리뷰 R-4): 실제 Redis를 멈춰 명령 시간 초과(2초)를 낸다. 한도·인증번호 저장 없이 문자를 보내지 않는다.
        var docker = REDIS.getDockerClient();
        docker.pauseContainerCmd(REDIS.getContainerId()).exec();
        try {
            request(PHONE, "SIGN_UP")
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
        } finally {
            docker.unpauseContainerCmd(REDIS.getContainerId()).exec();
        }
        verify(sms, never()).send(anyString(), anyString());
    }

    @Test
    void 기능이_꺼져_있으면_저장도_발송도_하지_않는다() throws Exception {
        when(sms.enabled()).thenReturn(false);
        request(PHONE, "SIGN_UP")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SMS_UNAVAILABLE"));
        verify(sms, never()).send(anyString(), anyString());
        assertThat(redis.keys("runway:auth:phone:*")).isEmpty();
    }

    @Test
    void 형식_오류는_400이고_오입력으로_세지_않는다() throws Exception {
        for (String json : new String[] {
            "{\"phoneNumber\":\"010-1234-5678\",\"purpose\":\"SIGN_UP\"}",
            "{\"phoneNumber\":1012345678,\"purpose\":\"SIGN_UP\"}",
            "{\"phoneNumber\":\"01012345678\",\"purpose\":\"LOGIN\"}",
            "{\"phoneNumber\":\"01012345678\"}",
            "not-json"
        }) {
            mvc.perform(post("/api/v1/auth/phone-verifications")
                            .contentType(MediaType.APPLICATION_JSON).content(json))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        request(PHONE, "SIGN_UP").andExpect(status().isOk());
        String code = lastCode();
        for (String bad : new String[] {"12345", "1234567", "abcdef"}) {
            confirm(PHONE, "SIGN_UP", bad)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        confirm(PHONE, "SIGN_UP", code).andExpect(status().isOk());
    }
}
