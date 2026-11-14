package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.session.dto.request.CreateRunningSessionRequest;
import com.runway.backend.domain.session.dto.request.UpdateRunningSessionRequest;
import com.runway.backend.domain.session.service.PersonalPacePlanPort;
import com.runway.backend.domain.session.service.RunningSessionService;
import com.zaxxer.hikari.HikariDataSource;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * S15P31E105-822. S01 세션 생성·S08 목표 변경이 동시에 몰려도 DB 커넥션 풀(기본 10개)이 교착하지 않는지 확인한다.
 *
 * <p>수정 전에는 두 메서드의 {@code @Transactional(NOT_SUPPORTED)}가 빈 트랜잭션 동기화 범위를 열었다. JDBC 커넥션은 저장 트랜잭션 시작 때 반납되지만
 * 동기화 범위에 묶인 EntityManager 커넥션을 쥔 채 저장용 커넥션을 또 기다렸고, 동시 요청이 풀 크기를 넘으면 서로 기다리다 5초 뒤 모두 503이었다.
 * 요청 수(20)는 풀 크기의 2배이며, 시간 상한 단언은 기계 성능에 흔들려 쓰지 않는다. 교착은 503 응답과 응답 대기 시간 초과로 판정한다. 모든
 * 데이터는 합성이다.
 */
class RunningSessionPoolConcurrencyIntegrationTest extends RunningSessionIntegrationSupport {

    private static final int BURST = 20;
    /** Hikari 기본 풀(10)보다 많은 동시 요청. 요청이 커넥션을 하나씩만 쥐어도 10개에서 막힌다. */
    private static final int OVER_POOL = 12;

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Autowired private RunningSessionService service;
    @Autowired private DataSource dataSource;
    @Autowired private PlatformTransactionManager transactionManager;

    private record Hit(int status, String body) {
        JsonNode json() {
            return JSON.readTree(body);
        }

        String code() {
            return json().path("code").asString();
        }
    }

    private List<Hit> concurrently(List<Callable<MvcResult>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Hit>> futures = new ArrayList<>();
            for (Callable<MvcResult> call : calls) {
                futures.add(pool.submit(() -> run(start, call)));
            }
            start.countDown();
            List<Hit> hits = new ArrayList<>();
            for (Future<Hit> future : futures) {
                hits.add(future.get(60, TimeUnit.SECONDS));
            }
            return hits;
        } finally {
            pool.shutdownNow();
        }
    }

    private static Hit run(CountDownLatch start, Callable<MvcResult> call) throws Exception {
        start.await();
        MvcResult result = call.call();
        return new Hit(
                result.getResponse().getStatus(), result.getResponse().getContentAsString());
    }

    private static String createBody(long watch, long phone) {
        return "{\"controlDeviceId\":"
                + watch
                + ",\"relayDeviceId\":"
                + phone
                + ",\"targetDistanceM\":5000}";
    }

    private static String updateGoalBody(int distanceM) {
        return "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetDistanceM\":"
                + distanceM
                + "}";
    }

    /** 사용자 + 연결된 워치·폰. 생성 요청 호출을 돌려준다. */
    private Callable<MvcResult> createCallFor(long user, long watch, long phone) {
        return () -> mockMvc.perform(createRequest(user, createBody(watch, phone))).andReturn();
    }

    private List<Callable<MvcResult>> createCallsForNewUsers(int count) {
        List<Callable<MvcResult>> calls = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            long user = insertUser("AGREE");
            long watch = insertDevice(user, "WATCH", false);
            long phone = insertDevice(user, "PHONE", false);
            calls.add(createCallFor(user, watch, phone));
        }
        return calls;
    }

    /** 거리만 있는 목표의 AI 응답(1km 구간, 비율 1). 가짜 포트 기본 응답과 같고 호출을 붙잡는 테스트가 쓴다. */
    private static Optional<PersonalPacePlanPort.Result> flatPlan(
            Long user, com.runway.backend.domain.session.entity.SessionGoal goal) {
        BigDecimal distance = BigDecimal.valueOf(goal.distanceM());
        List<PersonalPacePlanPort.Segment> segments = new ArrayList<>();
        for (BigDecimal start = BigDecimal.ZERO;
                start.compareTo(distance) < 0;
                start = start.add(BigDecimal.valueOf(1000))) {
            segments.add(
                    new PersonalPacePlanPort.Segment(
                            segments.size() + 1,
                            start,
                            distance.min(start.add(BigDecimal.valueOf(1000))),
                            BigDecimal.valueOf(360),
                            BigDecimal.ONE));
        }
        return Optional.of(
                new PersonalPacePlanPort.Result(
                        goal.courseId(), user, distance, BigDecimal.valueOf(360), segments));
    }

    /** AC-1. 서로 다른 사용자 20명이 동시에 세션을 만들어도 모두 201이다. */
    @Test
    @Timeout(120)
    void 서로_다른_사용자_20명_동시_생성은_모두_201이다() throws Exception {
        List<Callable<MvcResult>> calls = createCallsForNewUsers(BURST);

        List<Hit> hits = concurrently(calls);

        assertThat(hits).extracting(Hit::status).containsOnly(201);
        assertThat(count("SELECT count(*) FROM running_sessions WHERE status='READY'"))
                .isEqualTo(BURST);
        assertThat(
                        count(
                                "SELECT count(DISTINCT user_id) FROM running_sessions"
                                        + " WHERE status='READY'"))
                .isEqualTo(BURST);
        assertThat(count("SELECT count(*) FROM pace_plans")).isEqualTo(BURST);
    }

    /** AC-2. 같은 사용자의 20개 동시 생성은 1개 201, 나머지 19개는 409 ACTIVE_SESSION_EXISTS다. */
    @Test
    @Timeout(120)
    void 같은_사용자_20개_동시_생성은_1개_201_19개_409이다() throws Exception {
        List<Callable<MvcResult>> calls = new ArrayList<>();
        for (int i = 0; i < BURST; i++) {
            calls.add(createCallFor(userId, watchId, phoneId));
        }

        List<Hit> hits = concurrently(calls);

        List<Hit> created = hits.stream().filter(h -> h.status() == 201).toList();
        List<Hit> conflicts = hits.stream().filter(h -> h.status() == 409).toList();
        assertThat(created).hasSize(1);
        assertThat(conflicts).hasSize(BURST - 1);
        long sessionId = created.get(0).json().path("sessionId").asLong();
        assertThat(conflicts)
                .allSatisfy(
                        hit -> {
                            assertThat(hit.code()).isEqualTo("ACTIVE_SESSION_EXISTS");
                            assertThat(hit.json().path("details").path("sessionId").asLong())
                                    .isEqualTo(sessionId);
                        });
        assertThat(count("SELECT count(*) FROM running_sessions WHERE user_id=?", userId))
                .isEqualTo(1);
    }

    /** AC-3. 한 사용자의 연타 중에도 다른 사용자의 생성·조회·목표 변경은 503 없이 성공한다. */
    @Test
    @Timeout(120)
    void 연타_중에도_다른_사용자의_생성_조회_변경은_막히지_않는다() throws Exception {
        long other = insertUser("AGREE");
        long otherWatch = insertDevice(other, "WATCH", false);
        long otherPhone = insertDevice(other, "PHONE", false);
        long third = insertUser("AGREE");
        long thirdWatch = insertDevice(third, "WATCH", false);
        long thirdPhone = insertDevice(third, "PHONE", false);
        long thirdSession = insertSession(third, "READY", 1, thirdWatch, thirdPhone, "PENDING", null);

        List<Callable<MvcResult>> calls = new ArrayList<>();
        for (int i = 0; i < BURST; i++) {
            calls.add(createCallFor(userId, watchId, phoneId));
        }
        calls.add(createCallFor(other, otherWatch, otherPhone));
        calls.add(() -> mockMvc.perform(getRequest(third, thirdSession)).andReturn());
        calls.add(
                () ->
                        mockMvc.perform(patchRequest(third, thirdSession, updateGoalBody(3000)))
                                .andReturn());

        List<Hit> hits = concurrently(calls);

        List<Hit> burst = hits.subList(0, BURST);
        List<Hit> burstCreated = burst.stream().filter(h -> h.status() == 201).toList();
        List<Hit> burstConflicts = burst.stream().filter(h -> h.status() == 409).toList();
        assertThat(burstCreated).hasSize(1);
        assertThat(burstConflicts).hasSize(BURST - 1);
        long burstSessionId = burstCreated.get(0).json().path("sessionId").asLong();
        assertThat(burstConflicts)
                .allSatisfy(
                        hit -> {
                            assertThat(hit.code()).isEqualTo("ACTIVE_SESSION_EXISTS");
                            assertThat(hit.json().path("details").path("sessionId").asLong())
                                    .isEqualTo(burstSessionId);
                        });
        assertThat(hits.get(BURST).status()).isEqualTo(201);
        assertThat(hits.get(BURST + 1).status()).isEqualTo(200);
        assertThat(hits.get(BURST + 2).status()).isEqualTo(200);
        assertThat(hits).extracting(Hit::status).doesNotContain(503);
    }

    /** AC-4. S01은 AI 계획 호출 동안 커넥션을 쥐지 않는다. 풀(10)보다 많은 요청이 모두 AI 호출 안에 들어간다. */
    @Test
    @Timeout(120)
    void 생성은_AI_계획_호출_동안_커넥션을_쥐지_않는다() throws Exception {
        long bystanderSession = insertReadySession();
        List<Callable<MvcResult>> calls = createCallsForNewUsers(OVER_POOL);

        List<Hit> hits = withAiCallsHeld(calls, bystanderSession);

        assertThat(hits).extracting(Hit::status).containsOnly(201);
    }

    /** AC-5. S08 UPDATE_GOAL은 AI 계획 호출 동안 커넥션을 쥐지 않는다. */
    @Test
    @Timeout(120)
    void 목표_변경은_AI_계획_호출_동안_커넥션을_쥐지_않는다() throws Exception {
        long bystanderSession = insertReadySession();
        List<Callable<MvcResult>> calls = new ArrayList<>();
        List<Long> sessions = new ArrayList<>();
        for (int i = 0; i < OVER_POOL; i++) {
            long user = insertUser("AGREE");
            long watch = insertDevice(user, "WATCH", false);
            long phone = insertDevice(user, "PHONE", false);
            long session = insertSession(user, "READY", 1, watch, phone, "PENDING", null);
            sessions.add(session);
            calls.add(
                    () ->
                            mockMvc.perform(patchRequest(user, session, updateGoalBody(3000)))
                                    .andReturn());
        }

        List<Hit> hits = withAiCallsHeld(calls, bystanderSession);

        assertThat(hits).extracting(Hit::status).containsOnly(200);
        for (long session : sessions) {
            assertThat(stateVersion(session)).isEqualTo(2);
            assertThat(count("SELECT goal_distance FROM running_sessions WHERE id=?", session))
                    .isEqualTo(3000);
            assertThat(count("SELECT count(*) FROM pace_plans WHERE session_id=?", session))
                    .isEqualTo(1);
            assertThat(
                            count(
                                    "SELECT count(*) FROM pace_plan_segments s JOIN pace_plans p"
                                            + " ON p.id=s.pace_plan_id WHERE p.session_id=?",
                                    session))
                    .isEqualTo(3);
        }
    }

    /**
     * 요청 전부를 AI 포트 안에 붙잡아 두고 (1) 모두 도착했는지 (2) 그동안 무관한 조회가 성공하는지 (3) 풀의 사용 중 커넥션이 0인지 확인한 뒤 풀어
     * 응답을 돌려준다. 도착 수가 풀 크기에서 멈추면 요청이 커넥션을 쥐고 있다는 뜻이다.
     */
    private List<Hit> withAiCallsHeld(List<Callable<MvcResult>> calls, long bystanderSession)
            throws Exception {
        CountDownLatch arrived = new CountDownLatch(calls.size());
        CountDownLatch release = new CountDownLatch(1);
        personalPlan.answer =
                (user, goal) -> {
                    arrived.countDown();
                    try {
                        release.await(60, TimeUnit.SECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                    return flatPlan(user, goal);
                };
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Hit>> futures = new ArrayList<>();
            for (Callable<MvcResult> call : calls) {
                futures.add(pool.submit(() -> run(start, call)));
            }
            start.countDown();

            assertThat(arrived.await(20, TimeUnit.SECONDS))
                    .as("풀 크기보다 많은 요청이 모두 AI 호출에 도달해야 한다. 남은 수=%d", arrived.getCount())
                    .isTrue();
            assertThat(mockMvc.perform(getRequest(userId, bystanderSession)).andReturn().getResponse().getStatus())
                    .isEqualTo(200);
            assertThat(activeConnections()).as("AI 호출 대기 중 사용 중 커넥션").isZero();

            release.countDown();
            List<Hit> hits = new ArrayList<>();
            for (Future<Hit> future : futures) {
                hits.add(future.get(60, TimeUnit.SECONDS));
            }
            return hits;
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private int activeConnections() throws Exception {
        HikariDataSource hikari = dataSource.unwrap(HikariDataSource.class);
        return hikari.getHikariPoolMXBean().getActiveConnections();
    }

    /** AC-6. 같은 세션의 목표 변경 20개가 동시에 와도 하나만 반영되고 나머지는 409 STALE_STATE다. */
    @Test
    @Timeout(120)
    void 같은_세션_목표_변경_20개_동시는_하나만_반영된다() throws Exception {
        long session = insertReadySession();
        List<Callable<MvcResult>> calls = new ArrayList<>();
        for (int i = 0; i < BURST; i++) {
            int distance = 1000 + i * 100;
            calls.add(
                    () ->
                            mockMvc.perform(
                                            patchRequest(userId, session, updateGoalBody(distance)))
                                    .andReturn());
        }

        List<Hit> hits = concurrently(calls);

        assertThat(hits.stream().filter(h -> h.status() == 200).count()).isEqualTo(1);
        List<Hit> conflicts = hits.stream().filter(h -> h.status() == 409).toList();
        assertThat(conflicts).hasSize(BURST - 1);
        assertThat(conflicts).extracting(Hit::code).containsOnly("STALE_STATE");
        assertThat(stateVersion(session)).isEqualTo(2);
        assertThat(count("SELECT count(*) FROM pace_plans WHERE session_id=?", session))
                .isEqualTo(1);
    }

    /**
     * AC-8(D-1). 호출자 트랜잭션 안에서 부르면 작업 종류와 관계없이 맨 앞에서 거절한다. 예전에는 NOT_SUPPORTED가 바깥 트랜잭션을 조용히 중단했다.
     * 호출하는 운영 코드는 없다.
     */
    @Test
    @Timeout(120)
    void 트랜잭션_안에서_생성을_부르면_거절한다() {
        CreateRunningSessionRequest request =
                new CreateRunningSessionRequest(watchId, phoneId, null, null, 5000, null, null);

        assertThatThrownBy(
                        () ->
                                inTransaction(
                                        () -> service.create(userId, request, Instant.now())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("no active transaction");
        assertThat(count("SELECT count(*) FROM running_sessions WHERE user_id=?", userId)).isZero();
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    @Test
    @Timeout(120)
    void 트랜잭션_안에서_목표_변경을_부르면_거절한다() {
        long session = insertReadySession();
        UpdateRunningSessionRequest request =
                UpdateRunningSessionRequest.fromJson(updateGoalBody(3000));

        assertThatThrownBy(
                        () ->
                                inTransaction(
                                        () ->
                                                service.update(
                                                        userId, session, request, Instant.now())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("no active transaction");
        assertThat(stateVersion(session)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM pace_plans")).isZero();
    }

    /** prepare를 거치지 않는 작업(TAKE_OVER_PHONE)도 바깥 트랜잭션에 합류하지 않고 거절한다. */
    @Test
    @Timeout(120)
    void 트랜잭션_안에서_폰_인계를_부르면_거절한다() {
        long session = insertReadySession();
        UpdateRunningSessionRequest request =
                UpdateRunningSessionRequest.fromJson(
                        "{\"operation\":\"TAKE_OVER_PHONE\",\"expectedVersion\":1,\"deviceId\":"
                                + phoneId
                                + ",\"receivedWatchBatchesUploaded\":true}");

        assertThatThrownBy(
                        () ->
                                inTransaction(
                                        () ->
                                                service.update(
                                                        userId, session, request, Instant.now())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("no active transaction");
        assertThat(stateVersion(session)).isEqualTo(1);
    }

    private void inTransaction(Runnable work) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> work.run());
    }
}
