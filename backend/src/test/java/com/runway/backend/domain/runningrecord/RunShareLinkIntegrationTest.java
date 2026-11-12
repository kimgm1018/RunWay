package com.runway.backend.domain.runningrecord;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.domain.runningrecord.dto.request.RunShareLinkRequest;
import com.runway.backend.domain.runningrecord.dto.response.RunShareLinkResponse;
import com.runway.backend.domain.runningrecord.service.RunShareLinkService;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * H08 기록 공유 링크 발급·H09 공유 기록 조회(S15P31E105-704) — AC-3~AC-6, T-10~T-14. 합성 좌표·합성 회원만 쓴다.
 */
class RunShareLinkIntegrationTest extends SharedContextIntegrationSupport {

    private static final String TOKEN_REGEX = "[A-Za-z0-9_-]{43}";
    private static final String BASE_URL = "https://k15e105.p.ssafy.io/r/";
    private static final String IMAGE_UUID = "550e8400-e29b-41d4-a716-446655440000";

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private RunShareLinkService runShareLinkService;
    @Autowired private PlatformTransactionManager transactionManager;

    private long ownerId;
    private long otherId;
    private long sessionId;
    private long otherSessionId;

    @BeforeEach
    void seed() {
        ownerId = insertUser("share_owner", "공유러너", "01050001001");
        otherId = insertUser("share_other", "다른러너", "01050001002");
        jdbc.update(
                "UPDATE users SET profile_image_key=? WHERE id=?",
                "profiles/" + ownerId + "/" + IMAGE_UUID + ".jpg",
                ownerId);
        sessionId = insertCompletedSession(ownerId);
        otherSessionId = insertCompletedSession(otherId);
        // 첫 조각: 0·10·20초(정확도 40m인 15초 위치는 빠진다). 90초 공백 뒤 두 번째 조각: 110·120초.
        point(sessionId, 0, 127.0000, 5.0);
        point(sessionId, 10, 127.0001, null);
        point(sessionId, 15, 127.9000, 40.0);
        point(sessionId, 20, 127.0002, 5.0);
        point(sessionId, 110, 127.0010, 5.0);
        point(sessionId, 120, 127.0011, 5.0);
        // 종료 뒤 위치는 쓰지 않는다.
        point(sessionId, 4000, 128.0000, 5.0);
    }

    @Test
    void issuesOnceAndReuses() throws Exception {
        String first = issue(ownerId, sessionId, "자유 러닝");
        String token = JsonPath.read(first, "$.token");
        assertThat(token).matches(TOKEN_REGEX);
        assertThat((String) JsonPath.read(first, "$.url")).isEqualTo(BASE_URL + token);

        String second = issue(ownerId, sessionId, "  저녁 러닝  ");
        assertThat((String) JsonPath.read(second, "$.token")).isEqualTo(token);
        assertThat((String) JsonPath.read(second, "$.url")).isEqualTo(BASE_URL + token);

        // 같은 제목으로 다시 요청해도 같은 token이다(행을 고치지 않는 경로).
        String third = issue(ownerId, sessionId, "저녁 러닝");
        assertThat((String) JsonPath.read(third, "$.token")).isEqualTo(token);

        assertThat(count("SELECT count(*) FROM run_share_links")).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT title FROM run_share_links WHERE session_id=?",
                                String.class,
                                sessionId))
                .isEqualTo("저녁 러닝");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT user_id FROM run_share_links WHERE session_id=?",
                                Long.class,
                                sessionId))
                .isEqualTo(ownerId);
    }

    /**
     * 먼저 들어온 발급이 아직 커밋하지 않은 동안 두 번째 발급이 session_id UNIQUE에서 기다렸다가, 첫 커밋 뒤 같은 token을 받는다. 두
     * 요청이 실제로 겹쳤는지는 두 번째 요청의 잠금 대기를 확인해 보장한다.
     */
    @Test
    void concurrentFirstIssueReturnsSameToken() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch firstInserted = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        try {
            Future<RunShareLinkResponse> first =
                    executor.submit(
                            () ->
                                    new TransactionTemplate(transactionManager)
                                            .execute(
                                                    tx -> {
                                                        RunShareLinkResponse response =
                                                                runShareLinkService.issue(
                                                                        ownerId,
                                                                        sessionId,
                                                                        new RunShareLinkRequest(
                                                                                "자유 러닝"));
                                                        firstInserted.countDown();
                                                        await(releaseFirst);
                                                        return response;
                                                    }));
            assertThat(firstInserted.await(10, TimeUnit.SECONDS)).isTrue();

            Future<RunShareLinkResponse> second =
                    executor.submit(
                            () ->
                                    runShareLinkService.issue(
                                            ownerId,
                                            sessionId,
                                            new RunShareLinkRequest("자유 러닝")));
            waitForLockWait();
            assertThat(second.isDone()).isFalse();

            releaseFirst.countDown();
            RunShareLinkResponse firstResponse = first.get(10, TimeUnit.SECONDS);
            RunShareLinkResponse secondResponse = second.get(10, TimeUnit.SECONDS);

            assertThat(firstResponse.token()).matches(TOKEN_REGEX);
            assertThat(secondResponse.token()).isEqualTo(firstResponse.token());
            assertThat(secondResponse.url()).isEqualTo(BASE_URL + firstResponse.token());
            assertThat(count("SELECT count(*) FROM run_share_links")).isEqualTo(1);
        } finally {
            releaseFirst.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void concurrentFirstIssueWithoutOrderingReturnsSameToken() throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        List<CompletableFuture<RunShareLinkResponse>> calls =
                List.of(
                        CompletableFuture.supplyAsync(
                                () -> {
                                    await(start);
                                    return runShareLinkService.issue(
                                            ownerId, sessionId, new RunShareLinkRequest("A"));
                                }),
                        CompletableFuture.supplyAsync(
                                () -> {
                                    await(start);
                                    return runShareLinkService.issue(
                                            ownerId, sessionId, new RunShareLinkRequest("B"));
                                }));
        start.countDown();
        String a = calls.get(0).get(10, TimeUnit.SECONDS).token();
        String b = calls.get(1).get(10, TimeUnit.SECONDS).token();
        assertThat(a).isEqualTo(b);
        assertThat(count("SELECT count(*) FROM run_share_links")).isEqualTo(1);
    }

    @Test
    void rejectsNotOwnerNotFoundInvalidTitleAndUnauthenticated() throws Exception {
        mockMvc.perform(issueRequest(ownerId, otherSessionId, "자유 러닝"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));

        long deleted = insertCompletedSession(ownerId);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);
        mockMvc.perform(issueRequest(ownerId, deleted, "자유 러닝"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECORD_NOT_FOUND"));
        mockMvc.perform(issueRequest(ownerId, 999_999_999L, "자유 러닝"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECORD_NOT_FOUND"));

        for (String body :
                new String[] {
                    "{\"title\":\"   \"}",
                    "{\"title\":\"\"}",
                    "{}",
                    "{\"title\":\"" + "가".repeat(41) + "\"}",
                    "{\"title\":\"" + "a".repeat(41) + "\"}",
                    // 제어 문자(NUL)·양방향 재정렬(U+202E)·폭 없는 공백(U+200B)과 짝 없는 서로게이트.
                    "{\"title\":\"자유\\u0000러닝\"}",
                    "{\"title\":\"\\u202e닝러 유자\"}",
                    "{\"title\":\"\\u200b\"}",
                    "{\"title\":\"자유\\u200b러닝\"}",
                    "{\"title\":\"자유\\ud800러닝\"}"
                }) {
            mockMvc.perform(
                            post("/api/v1/running-records/" + sessionId + "/share-link")
                                    .header("Authorization", SecurityTestSupport.bearer(ownerId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }

        mockMvc.perform(
                        post("/api/v1/running-records/" + sessionId + "/share-link")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"자유 러닝\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        assertThat(count("SELECT count(*) FROM run_share_links")).isZero();

        // 경계: 앞뒤 공백을 뺀 40자는 허용하고 제거한 값으로 저장한다.
        String forty = "가".repeat(40);
        issue(ownerId, sessionId, "  " + forty + "  ");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT title FROM run_share_links WHERE session_id=?",
                                String.class,
                                sessionId))
                .isEqualTo(forty);

        // 글자 수는 코드 포인트로 센다(닉네임과 같음). 이모지 40개는 허용한다.
        String emojis = "🏃".repeat(40);
        issue(ownerId, sessionId, emojis);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT title FROM run_share_links WHERE session_id=?",
                                String.class,
                                sessionId))
                .isEqualTo(emojis);
    }

    /**
     * 탈퇴 뒤에도 남은 JWT로 H08을 부르면 H02와 같이 기록 접근 검사로 거절한다. 탈퇴 처리(U18)가 기록을 삭제 표시하므로 404
     * RECORD_NOT_FOUND이고, 탈퇴와 겹쳐 기록이 아직 남아 있으면 DB 쓰기 차단(rw_active_owner)이 401로 거절한다. 둘 다 행을 만들지 않는다.
     */
    @Test
    void withdrawnIssuerWithValidTokenIsRejected() throws Exception {
        long raced = insertCompletedSession(ownerId);
        // U18과 같은 순서: 기록 삭제 표시 뒤 회원 탈퇴(탈퇴 회원 행에는 기록 쓰기가 막힌다).
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", sessionId);
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                ownerId);

        mockMvc.perform(issueRequest(ownerId, sessionId, "자유 러닝"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECORD_NOT_FOUND"));
        mockMvc.perform(issueRequest(ownerId, raced, "자유 러닝"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        assertThat(count("SELECT count(*) FROM run_share_links")).isZero();
    }

    @Test
    void readsWithoutAuthMinimalFields() throws Exception {
        String token = JsonPath.read(issue(ownerId, sessionId, "자유 러닝"), "$.token");

        String body =
                mockMvc.perform(get("/api/v1/shared-runs/" + token))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.title").value("자유 러닝"))
                        .andExpect(jsonPath("$.startedAt").value("2026-03-01T10:00:00Z"))
                        .andExpect(jsonPath("$.distanceM").value(5021.4))
                        .andExpect(jsonPath("$.durationSec").value(1712))
                        .andExpect(jsonPath("$.averagePaceSecPerKm").value(341.0))
                        .andExpect(jsonPath("$.cadence").value(172.0))
                        .andExpect(jsonPath("$.runner.nickname").value("공유러너"))
                        .andExpect(
                                jsonPath("$.runner.profileImageUrl")
                                        .value("/api/v1/images/" + IMAGE_UUID))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        Map<String, Object> root = JsonPath.read(body, "$");
        assertThat(root.keySet())
                .containsExactlyInAnyOrder(
                        "title",
                        "startedAt",
                        "distanceM",
                        "durationSec",
                        "averagePaceSecPerKm",
                        "cadence",
                        "runner",
                        "segments");
        Map<String, Object> runner = JsonPath.read(body, "$.runner");
        assertThat(runner.keySet()).containsExactlyInAnyOrder("nickname", "profileImageUrl");
        List<Map<String, Object>> segments = JsonPath.read(body, "$.segments");
        assertThat(segments).hasSize(2);
        for (Map<String, Object> segment : segments) {
            assertThat(segment.keySet()).isEqualTo(Set.of("coordinates"));
        }

        // S11(본인 경로 조회)과 같은 경로 선택 규칙의 결과다.
        String route =
                mockMvc.perform(
                                get("/api/v1/running-sessions/" + sessionId + "/route")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(ownerId)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        List<Object> routeCoordinates = JsonPath.read(route, "$.segments[*].coordinates");
        List<Object> sharedCoordinates = JsonPath.read(body, "$.segments[*].coordinates");
        assertThat(sharedCoordinates).isEqualTo(routeCoordinates);
        assertThat(sharedCoordinates).hasSize(2);
        assertThat((List<Object>) JsonPath.read(body, "$.segments[0].coordinates")).hasSize(3);

        mockMvc.perform(head("/api/v1/shared-runs/" + token)).andExpect(status().isOk());
        // 공개 범위는 GET/HEAD 단일 토큰 경로뿐이다.
        mockMvc.perform(post("/api/v1/shared-runs/" + token)).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/shared-runs/" + token + "/x"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void notFoundForUnknownMalformedDeletedWithdrawn() throws Exception {
        String unknown = "A".repeat(43);
        for (String token :
                new String[] {unknown, "abc", "A".repeat(44), "A".repeat(42) + "."}) {
            expectSharedRunNotFound(token);
        }

        String token = JsonPath.read(issue(ownerId, sessionId, "자유 러닝"), "$.token");
        mockMvc.perform(get("/api/v1/shared-runs/" + token)).andExpect(status().isOk());
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", sessionId);
        expectSharedRunNotFound(token);

        String otherToken =
                JsonPath.read(issue(otherId, otherSessionId, "다른 러닝"), "$.token");
        mockMvc.perform(get("/api/v1/shared-runs/" + otherToken)).andExpect(status().isOk());
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                otherId);
        expectSharedRunNotFound(otherToken);
    }

    /** 완료(COMPLETED) 기록만 공유한다. 진행 중 세션은 발급하지 않고, 완료가 아닌 세션의 링크는 열리지 않는다. */
    @Test
    void notCompletedSessionIsNotIssuedAndNotReadable() throws Exception {
        long running = insertRunningSession(ownerId);

        mockMvc.perform(issueRequest(ownerId, running, "자유 러닝"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECORD_NOT_FOUND"));
        assertThat(count("SELECT count(*) FROM run_share_links")).isZero();

        // H08을 우회해 직접 저장한 링크라도 세션이 완료가 아니면 H09는 404다.
        String token = "B".repeat(43);
        jdbc.update(
                "INSERT INTO run_share_links(session_id,user_id,token,title) VALUES (?,?,?,?)",
                running,
                ownerId,
                token,
                "진행 중");
        expectSharedRunNotFound(token);
    }

    private long insertRunningSession(long userId) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id, status, started_at)
                VALUES (?, 'RUNNING'::running_sessions_status_enum, now() - interval '10 minutes')
                RETURNING id
                """,
                Long.class,
                userId);
    }

    private void expectSharedRunNotFound(String token) throws Exception {
        mockMvc.perform(get("/api/v1/shared-runs/" + token))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SHARED_RUN_NOT_FOUND"));
    }

    private String issue(long userId, long session, String title) throws Exception {
        return mockMvc.perform(issueRequest(userId, session, title))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    private MockHttpServletRequestBuilder issueRequest(long userId, long session, String title) {
        return post("/api/v1/running-records/" + session + "/share-link")
                .header("Authorization", SecurityTestSupport.bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"" + title + "\"}");
    }

    private void waitForLockWait() throws InterruptedException {
        for (int i = 0; i < 200; i++) {
            Integer waiting =
                    jdbc.queryForObject(
                            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()"
                                    + " AND wait_event_type='Lock'",
                            Integer.class);
            if (waiting != null && waiting > 0) {
                return;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("두 번째 발급이 잠금 대기에 들어가지 않았습니다.");
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("latch timeout");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private int count(String sql) {
        Integer value = jdbc.queryForObject(sql, Integer.class);
        return value == null ? 0 : value;
    }

    private long insertUser(String loginId, String nickname, String phone) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname,
                phone);
    }

    private long insertCompletedSession(long userId) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(
                  user_id, status, started_at, ended_at, total_distance, moving_duration,
                  elapsed_duration, average_pace, average_heart_rate, average_cadence, goal_achieved)
                VALUES (?, 'COMPLETED'::running_sessions_status_enum,
                        '2026-03-01T10:00:00Z'::timestamptz, '2026-03-01T11:00:00Z'::timestamptz,
                        5021.40, 1712, 1800, 341.00, 150.00, 172.00, true)
                RETURNING id
                """,
                Long.class,
                userId);
    }

    /** 세션 시작 기준 sec초 뒤의 합성 위치. 기기 정보가 없으므로 출처는 PHONE이다. */
    private void point(long session, long sec, double lng, Double accuracy) {
        jdbc.update(
                """
                INSERT INTO running_route_points(running_session_id,measured_at,position,accuracy)
                SELECT ?, s.started_at + make_interval(secs => ?),
                       ST_SetSRID(ST_MakePoint(?, 37.5), 4326)::geography, ?
                  FROM running_sessions s WHERE s.id = ?
                """,
                session,
                (double) sec,
                lng,
                accuracy,
                session);
    }
}
