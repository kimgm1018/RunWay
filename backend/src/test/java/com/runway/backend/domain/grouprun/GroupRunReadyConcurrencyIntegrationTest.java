package com.runway.backend.domain.grouprun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.json.JsonMapper;

/**
 * S15P31E105-821. G16 준비 연타가 커넥션 풀(기본 10개)을 교착시키지 않는지 확인한다. 수정 전에는 같은 사용자 20개 동시 요청이 사전 조회
 * 단계에서 커넥션을 서로 기다리다 5초 뒤 모두 503 SERVICE_UNAVAILABLE이었다.
 *
 * <p>교착 재현은 Hikari 기본 풀 크기 10과 application.yml의 connection-timeout 5초에 의존한다. 동시 요청 수(20·12)가 풀
 * 크기보다 커야 수정 전 코드에서 실패한다. 풀 크기나 대기 시간을 바꾸면 이 테스트가 회귀를 잡는지 다시 확인한다.
 */
class GroupRunReadyConcurrencyIntegrationTest extends SharedContextIntegrationSupport {
    private static final int BURST = 20;
    private static final int CROWD = 12;
    private static final String READY = "{\"ready\":true}";
    private static final String UNREADY = "{\"ready\":false}";

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper mapper;

    private long hostId;
    private long memberId;
    private long phoneOnlyId;
    private long crewId;

    @BeforeEach
    void seed() {
        hostId = insertUser("gr_rc_host", "호스트", "01044440001");
        memberId = insertUser("gr_rc_member", "멤버", "01044440002");
        phoneOnlyId = insertUser("gr_rc_phone", "폰만", "01044440003");
        insertDevice(hostId, "WATCH");
        insertDevice(hostId, "PHONE");
        insertDevice(memberId, "WATCH");
        insertDevice(memberId, "PHONE");
        crewId = insertCrew(hostId, "준비연타 크루");
        approveMember(crewId, hostId);
        approveMember(crewId, memberId);
        approveMember(crewId, phoneOnlyId);
    }

    /**
     * 같은 사용자가 응답 전 준비를 20번 동시에 보내도 그룹 행 잠금으로 직렬화되어 모두 200이다. READY 세션은 하나만 만들어지고 모든 응답이 같은
     * sessionId를 돌려준다.
     */
    @Test
    void sameUserBurst_allSucceed_withSingleReadySession() throws Exception {
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);

        List<MvcResult> results =
                concurrently(Collections.nCopies(BURST, () -> ready(groupRunId, memberId, READY)));

        assertThat(results).extracting(r -> r.getResponse().getStatus()).containsOnly(200);
        assertThat(results.stream().map(this::sessionIdOf).collect(Collectors.toSet())).hasSize(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM running_sessions WHERE user_id=?",
                                Integer.class,
                                memberId))
                .isEqualTo(1);
        assertThat(participantReady(groupRunId, memberId)).isTrue();
    }

    /** 한 사용자의 연타와 동시에 보낸 다른 사용자의 준비·대기방 조회도 커넥션 대기 시간초과(503) 없이 200이다. */
    @Test
    void sameUserBurst_doesNotBlockOtherUsers() throws Exception {
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);

        List<Callable<MvcResult>> calls = new ArrayList<>();
        for (int i = 0; i < BURST; i++) {
            calls.add(() -> ready(groupRunId, memberId, READY));
        }
        calls.add(() -> ready(groupRunId, hostId, READY));
        calls.add(
                () ->
                        mockMvc.perform(
                                        get("/api/v1/group-runs/{id}/participants", groupRunId)
                                                .header(
                                                        "Authorization",
                                                        SecurityTestSupport.bearer(hostId)))
                                .andReturn());

        List<MvcResult> results = concurrently(calls);

        assertThat(results).extracting(r -> r.getResponse().getStatus()).containsOnly(200);
        assertThat(sessionIdOf(results.get(BURST))).isPositive();
        assertThat(participantReady(groupRunId, hostId)).isTrue();
        assertThat(participantReady(groupRunId, memberId)).isTrue();
    }

    /** 출발 직전처럼 서로 다른 참가자 12명이 한 번씩 동시에 준비해도 모두 200이고 각자 READY 세션이 하나씩 생긴다. */
    @Test
    void differentParticipantsReadyTogether_allSucceed() throws Exception {
        long groupRunId = createGroupRun();
        List<Long> users = new ArrayList<>();
        for (int i = 0; i < CROWD; i++) {
            long userId =
                    insertUser("gr_rc_crowd" + i, "참가자" + i, "0104445%04d".formatted(i + 10));
            insertDevice(userId, "WATCH");
            insertDevice(userId, "PHONE");
            approveMember(crewId, userId);
            join(groupRunId, userId);
            users.add(userId);
        }

        List<Callable<MvcResult>> calls = new ArrayList<>();
        for (long userId : users) {
            calls.add(() -> ready(groupRunId, userId, READY));
        }
        List<MvcResult> results = concurrently(calls);

        assertThat(results).extracting(r -> r.getResponse().getStatus()).containsOnly(200);
        for (long userId : users) {
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT count(*) FROM running_sessions WHERE user_id=?",
                                    Integer.class,
                                    userId))
                    .isEqualTo(1);
            assertThat(participantReady(groupRunId, userId)).isTrue();
        }
    }

    /** 준비 취소 연타도 모두 200이고, 연결이 끊긴 채 기존 READY 세션 하나만 취소된다. */
    @Test
    void sameUserUnreadyBurst_allSucceed() throws Exception {
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);
        long sessionId = sessionIdOf(ready(groupRunId, memberId, READY));

        List<MvcResult> results =
                concurrently(
                        Collections.nCopies(BURST, () -> ready(groupRunId, memberId, UNREADY)));

        assertThat(results).extracting(r -> r.getResponse().getStatus()).containsOnly(200);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status::text FROM running_sessions WHERE id=?",
                                String.class,
                                sessionId))
                .isEqualTo("CANCELLED");
        assertThat(participantReady(groupRunId, memberId)).isFalse();
        assertThat(
                        jdbc.queryForObject(
                                """
                                SELECT session_id IS NULL FROM group_run_participants
                                WHERE group_run_id=? AND user_id=?
                                """,
                                Boolean.class,
                                groupRunId,
                                memberId))
                .isTrue();
    }

    /** 기기 선택을 생략하면 폰만 연결된 사용자는 폰 전용, 워치도 연결된 사용자는 워치 기록으로 준비한다. */
    @Test
    void ready_defaultsToPhoneWithoutWatch_andWatchWhenLinked() throws Exception {
        long groupRunId = createGroupRun();
        join(groupRunId, phoneOnlyId);
        registerDevice(phoneOnlyId, "PHONE");

        MvcResult phoneOnly =
                mockMvc.perform(
                                post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(phoneOnlyId)))
                        .andExpect(status().isOk())
                        .andReturn();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT phone_only FROM running_sessions WHERE id=?",
                                Boolean.class,
                                sessionIdOf(phoneOnly)))
                .isTrue();

        assertThat(ready(groupRunId, phoneOnlyId, UNREADY).getResponse().getStatus()).isEqualTo(200);
        registerDevice(phoneOnlyId, "WATCH");
        MvcResult both =
                mockMvc.perform(
                                post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(phoneOnlyId)))
                        .andExpect(status().isOk())
                        .andReturn();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT phone_only FROM running_sessions WHERE id=?",
                                Boolean.class,
                                sessionIdOf(both)))
                .isFalse();
    }

    private List<MvcResult> concurrently(List<Callable<MvcResult>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        CountDownLatch start = new CountDownLatch(1);
        List<Future<MvcResult>> futures = new ArrayList<>();
        try {
            for (Callable<MvcResult> call : calls) {
                futures.add(
                        pool.submit(
                                () -> {
                                    start.await();
                                    return call.call();
                                }));
            }
            start.countDown();
            List<MvcResult> results = new ArrayList<>();
            for (Future<MvcResult> future : futures) {
                results.add(future.get(60, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private MvcResult ready(long groupRunId, long userId, String json) throws Exception {
        return mockMvc.perform(
                        post("/api/v1/group-runs/{id}/participants/me/ready", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(json))
                .andReturn();
    }

    private long sessionIdOf(MvcResult result) {
        try {
            return mapper.readTree(result.getResponse().getContentAsString())
                    .get("sessionId")
                    .asLong();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private boolean participantReady(long groupRunId, long userId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT ready FROM group_run_participants WHERE group_run_id=? AND user_id=?",
                        Boolean.class,
                        groupRunId,
                        userId));
    }

    private void registerDevice(long userId, String type) throws Exception {
        mockMvc.perform(
                        post("/api/v1/devices")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"deviceType\":\"" + type + "\"}"))
                .andExpect(status().isCreated());
    }

    private void join(long groupRunId, long userId) throws Exception {
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk());
    }

    private long createGroupRun() throws Exception {
        MvcResult created =
                mockMvc.perform(
                                post("/api/v1/group-runs")
                                        .header("Authorization", SecurityTestSupport.bearer(hostId))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {
                                                  "title":"준비연타 그룹런",
                                                  "crewId":%d,
                                                  "scheduledAt":"%s",
                                                  "meetingPosition":{"type":"Point","coordinates":[129.118,35.153]},
                                                  "meetingPlaceName":"집결지",
                                                  "meetingAddress":"부산",
                                                  "targetDistanceM":5000,
                                                  "goalInputType":"TIME",
                                                  "targetDurationSec":1800
                                                }
                                                """
                                                        .formatted(
                                                                crewId,
                                                                GroupRunTestTimes
                                                                        .validScheduledAt())))
                        .andExpect(status().isCreated())
                        .andReturn();
        return mapper.readTree(created.getResponse().getContentAsString()).get("id").asLong();
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

    private long insertCrew(long ownerId, String name) {
        return jdbc.queryForObject(
                """
                INSERT INTO crews(owner_id, name, capacity, status)
                VALUES (?, ?, 20, 'ACTIVE'::crews_status_enum)
                RETURNING id
                """,
                Long.class,
                ownerId,
                name);
    }

    private void approveMember(long crewId, long userId) {
        jdbc.update(
                """
                INSERT INTO crew_memberships(crew_id, user_id, status, joined_at)
                VALUES (?, ?, 'APPROVED'::crew_memberships_status_enum, now())
                """,
                crewId,
                userId);
    }

    private long insertDevice(long userId, String type) {
        return jdbc.queryForObject(
                """
                INSERT INTO user_devices(user_id, device_type, linked_at)
                VALUES (?, ?::user_devices_device_type_enum, now())
                RETURNING id
                """,
                Long.class,
                userId,
                type);
    }
}
