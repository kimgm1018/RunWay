package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest;
import com.runway.backend.domain.device.dto.request.SyncBatchRequest;
import com.runway.backend.domain.device.service.BatchPayloadHasher;
import com.runway.backend.domain.device.service.ConsentService;
import com.runway.backend.domain.device.service.HealthRecordSyncService;
import com.runway.backend.domain.device.service.SyncBatchService;
import com.runway.backend.domain.readiness.formula.ReadinessScore;
import com.runway.backend.domain.readiness.service.ReadinessEvaluationService;
import com.runway.backend.domain.session.dto.request.CreateRunningSessionRequest;
import com.runway.backend.domain.session.service.RunningSessionService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.security.SecurityTestSupport;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * S15P31E105-250 AC-7·AC-8·AC-10. 동의 철회와 W06·W07·준비도 평가(회원 행 FOR SHARE)·세션 생성이 실제 DB 트랜잭션에서 겹치도록
 * 실행하고, pg_locks로 대기를 관찰한 뒤 응답과 최종 DB 행으로 판정한다. 단일 서버·단일 DB 범위의 확인이며 값은 모두 합성 데이터다.
 */
@Testcontainers
class ConsentConcurrencyIntegrationTest extends SyncBatchIntegrationSupport {

    @Autowired private ConsentService consentService;
    @Autowired private SyncBatchService syncBatchService;
    @Autowired private HealthRecordSyncService healthRecordSyncService;
    @Autowired private RunningSessionService runningSessionService;
    @Autowired private ReadinessEvaluationService readinessEvaluationService;
    @Autowired private DataSource dataSource;
    @Autowired private PlatformTransactionManager transactionManager;

    private String revoke() {
        return change(false);
    }

    private String change(boolean granted) {
        try {
            consentService.change(userId, granted);
            return "OK";
        } catch (ApiException e) {
            return e.code();
        } catch (RuntimeException e) {
            return e.getClass().getSimpleName();
        }
    }

    private String w07(String json) {
        SyncBatchRequest request = SyncBatchRequest.parse(json.getBytes(StandardCharsets.UTF_8));
        try {
            syncBatchService.commit(userId, request, BatchPayloadHasher.verify(request));
            return "OK";
        } catch (ApiException e) {
            return e.code();
        } catch (RuntimeException e) {
            return e.getClass().getSimpleName();
        }
    }

    private String w06() {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        String body =
                "{\"provider\":\"RUNWAY_WATCH\",\"records\":[{\"type\":\"DAILY_HR_ESTIMATE\","
                        + "\"metricDate\":\""
                        + today
                        + "\",\"revision\":1,\"estimatedRestingHrBpm\":58.4,"
                        + "\"method\":\"ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2\",\"validSampleCount\":812,"
                        + "\"computedAt\":\""
                        + today
                        + "T09:00:00Z\"}]}";
        HealthRecordSyncRequest request =
                HealthRecordSyncRequest.parse(body.getBytes(StandardCharsets.UTF_8), today);
        try {
            healthRecordSyncService.sync(userId, request);
            return "OK";
        } catch (ApiException e) {
            return e.code();
        }
    }

    private static <T> CompletableFuture<T> async(Callable<T> task) {
        return CompletableFuture.supplyAsync(
                () -> {
                    try {
                        return task.call();
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                });
    }

    private String consent() {
        return jdbc.queryForObject(
                "SELECT health_data_access::text FROM users WHERE id=?", String.class, userId);
    }

    /** W06·준비도 평가가 회원 행을 FOR SHARE로 잡은 동안의 철회는 기다렸다가 그 트랜잭션이 끝난 뒤 완료된다. */
    @Test
    void 회원_행_FOR_SHARE_보유_중_철회는_뒤에_커밋된다() throws Exception {
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement share =
                    holder.prepareStatement("SELECT id FROM users WHERE id=? FOR SHARE")) {
                share.setLong(1, userId);
                share.executeQuery().close();
            }
            CompletableFuture<String> revoke = async(this::revoke);
            waitForLockWaits(1);
            assertThat(revoke).isNotDone();
            assertThat(consent()).isEqualTo("AGREE");
            holder.commit();

            assertThat(revoke.get(10, TimeUnit.SECONDS)).isEqualTo("OK");
        }
        assertThat(consent()).isEqualTo("DISAGREE");
    }

    /** 실제 W06이 회원 행을 잡고 저장 중이면(트리거로 1초 지연) 철회는 W06 커밋 뒤 완료된다. */
    @Test
    void W06_보유_중_철회는_뒤에_커밋된다() throws Exception {
        jdbc.execute(
                "CREATE OR REPLACE FUNCTION test_slow_consent_health() RETURNS trigger AS $$"
                        + " BEGIN PERFORM pg_sleep(1.0); RETURN NEW; END $$ LANGUAGE plpgsql");
        jdbc.execute(
                "CREATE TRIGGER test_slow_consent_health BEFORE INSERT ON daily_health_metrics"
                        + " FOR EACH ROW EXECUTE FUNCTION test_slow_consent_health()");
        try {
            CompletableFuture<String> w06 = async(this::w06);
            waitForQuery("pg_sleep");
            CompletableFuture<String> revoke = async(this::revoke);
            waitForLockWaits(1);
            // W06이 아직 저장 중(커밋 전)인 동안 철회는 회원 행에서 기다리고 있다.
            assertThat(w06).isNotDone();
            assertThat(revoke).isNotDone();

            assertThat(w06.get(10, TimeUnit.SECONDS)).isEqualTo("OK");
            assertThat(revoke.get(10, TimeUnit.SECONDS)).isEqualTo("OK");
        } finally {
            jdbc.execute("DROP TRIGGER test_slow_consent_health ON daily_health_metrics");
            jdbc.execute("DROP FUNCTION test_slow_consent_health()");
        }
        assertThat(count("SELECT count(*) FROM daily_health_metrics")).isEqualTo(1);
        assertThat(consent()).isEqualTo("DISAGREE");
    }

    /** 철회 트랜잭션이 커밋 전이면 W06은 회원 행에서 기다렸다가 커밋된 철회를 읽고 저장하지 않는다. */
    @Test
    void 철회_미커밋_중_W06은_기다린_뒤_거절된다() throws Exception {
        CompletableFuture<String> pending =
                whileRevokeOpen(
                        () -> {
                            CompletableFuture<String> w06 = async(this::w06);
                            waitForLockWaits(1);
                            assertThat(w06).isNotDone();
                            return w06;
                        });

        assertThat(pending.get(10, TimeUnit.SECONDS)).isEqualTo("CONSENT_REQUIRED");
        assertThat(count("SELECT count(*) FROM daily_health_metrics")).isZero();
    }

    /**
     * W07이 세션 행을 잡은 채 진행 중이면(기기 행을 다른 트랜잭션이 잡아 W07을 세워 둠) 철회는 세션 행에서 기다린다. W07은 철회 전 동의로 저장을
     * 마치고, 철회는 그 뒤에 완료된다.
     */
    @Test
    void W07_저장_중_철회는_W07_커밋_뒤에_완료된다() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock =
                    holder.prepareStatement("SELECT id FROM user_devices WHERE id=? FOR UPDATE")) {
                lock.setLong(1, watchId);
                lock.executeQuery().close();
            }
            CompletableFuture<String> w07 = async(() -> w07(body));
            waitForLockWaits(1);
            CompletableFuture<String> revoke = async(this::revoke);
            waitForLockWaits(2);
            // W07이 세션 행을 잡고 커밋 전인 동안 철회는 세션 행에서 기다리고 있다.
            assertThat(w07).isNotDone();
            assertThat(revoke).isNotDone();
            holder.rollback();

            assertThat(w07.get(10, TimeUnit.SECONDS)).isEqualTo("OK");
            assertThat(revoke.get(10, TimeUnit.SECONDS)).isEqualTo("OK");
        }
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isEqualTo(1);
        assertThat(consent()).isEqualTo("DISAGREE");
    }

    /**
     * 철회가 세션 행을 잡은 뒤 들어온 W07 측정 batch는 세션 잠금을 기다렸다가 커밋된 철회를 읽고 403이다. GPS만 있는 batch는 기존 규칙대로 받는다.
     */
    @Test
    void 철회가_세션을_잡으면_W07_측정_batch는_거절된다() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));

        CompletableFuture<String> pending =
                whileRevokeOpen(
                        () -> {
                            CompletableFuture<String> w07 = async(() -> w07(body));
                            waitForLockWaits(1);
                            assertThat(w07).isNotDone();
                            return w07;
                        });

        assertThat(pending.get(10, TimeUnit.SECONDS)).isEqualTo("CONSENT_REQUIRED");
        assertThat(storedRows()).isZero();
        assertThat(w07(batch(newBatchId(), watchId, sessionId, gps(2)))).isEqualTo("OK");
        assertThat(count("SELECT count(*) FROM running_route_points")).isEqualTo(1);
    }

    /**
     * 철회 도중 시작한 실제 세션 생성(S01 RunningSessionService.create)은 회원 세션 생성 잠금에서 기다렸다가 철회 커밋 뒤에 진행된다. 그 세션으로
     * 들어온 W07 측정 batch는 철회 값을 읽고 403이다.
     */
    @Test
    void 철회_중_세션_생성은_철회_뒤에_진행된다() throws Exception {
        CreateRunningSessionRequest request =
                new CreateRunningSessionRequest(watchId, phoneId, null, null, null, null, null);
        CompletableFuture<Long> pending =
                whileRevokeOpen(
                        () -> {
                            CompletableFuture<Long> create =
                                    async(
                                            () ->
                                                    runningSessionService
                                                            .create(userId, request, Instant.now())
                                                            .sessionId());
                            waitForLockWaits(1);
                            assertThat(create).isNotDone();
                            return create;
                        });

        long sessionId = pending.get(10, TimeUnit.SECONDS);
        assertThat(w07(batch(newBatchId(), watchId, sessionId, metric(1, 142))))
                .isEqualTo("CONSENT_REQUIRED");
        assertThat(storedRows()).isZero();
    }

    /**
     * 철회·동의·W07이 동시에 반복돼도 교착(40P01)·잠금 대기 초과(503) 없이 끝난다. 받은 batch는 측정 샘플까지 저장되고 거절된 batch는 아무것도
     * 남기지 않는다. 마지막 철회 뒤의 W07은 거절된다.
     */
    @RepeatedTest(10)
    void 철회와_W07_동시_반복에도_교착이_없다() throws Exception {
        long sessionId = runningSession();
        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            String body = batch(newBatchId(), watchId, sessionId, metric(i + 1, 142));
            tasks.add(() -> w07(body));
        }
        tasks.add(() -> change(true));
        tasks.add(this::revoke);
        tasks.add(this::revoke);

        List<String> results = runTogether(tasks);

        assertThat(results.subList(0, 3))
                .allMatch(r -> r.equals("OK") || r.equals("CONSENT_REQUIRED"));
        assertThat(results.subList(3, 6)).containsOnly("OK");
        int accepted = (int) results.subList(0, 3).stream().filter("OK"::equals).count();
        assertThat(count("SELECT count(*) FROM sync_batches")).isEqualTo(accepted);
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isEqualTo(accepted);
        assertThat(revoke()).isEqualTo("OK");
        assertThat(w07(batch(newBatchId(), watchId, sessionId, metric(9, 142))))
                .isEqualTo("CONSENT_REQUIRED");
    }

    /** 실제 준비도 평가가 회원 행을 FOR SHARE로 잡은 채 커밋 전이면 철회는 기다렸다가 평가 결과가 저장된 뒤 완료된다. */
    @Test
    void 준비도_평가_보유_중_철회는_뒤에_커밋된다() throws Exception {
        LocalDate today = seedReadinessInputs();
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        CompletableFuture<String> revoke =
                tx.execute(
                        s -> {
                            assertThat(readinessEvaluationService.evaluate(userId, today))
                                    .isPresent();
                            CompletableFuture<String> pending = async(this::revoke);
                            try {
                                waitForLockWaits(1);
                            } catch (InterruptedException e) {
                                throw new IllegalStateException(e);
                            }
                            assertThat(pending).isNotDone();
                            return pending;
                        });

        assertThat(revoke.get(10, TimeUnit.SECONDS)).isEqualTo("OK");
        assertThat(count("SELECT count(*) FROM daily_readiness WHERE user_id=?", userId))
                .isEqualTo(1);
        assertThat(consent()).isEqualTo("DISAGREE");
    }

    /** 철회 커밋 전 시작한 실제 준비도 평가는 회원 행에서 기다렸다가 철회 값을 읽고 저장하지 않는다. 같은 입력의 동의 회원은 평가가 저장된다. */
    @Test
    void 철회_미커밋_중_준비도_평가는_기다린_뒤_저장하지_않는다() throws Exception {
        LocalDate today = seedReadinessInputs();
        CompletableFuture<Optional<ReadinessScore>> pending =
                whileRevokeOpen(
                        () -> {
                            CompletableFuture<Optional<ReadinessScore>> evaluation =
                                    async(() -> readinessEvaluationService.evaluate(userId, today));
                            waitForLockWaits(1);
                            assertThat(evaluation).isNotDone();
                            return evaluation;
                        });

        assertThat(pending.get(10, TimeUnit.SECONDS)).isEmpty();
        assertThat(count("SELECT count(*) FROM daily_readiness WHERE user_id=?", userId)).isZero();
        assertThat(readinessEvaluationService.evaluate(otherUserId, today)).isPresent();
    }

    /** 종료된 과거 세션은 잠그지 않는다. 다른 트랜잭션(예: 과거 기록 댓글 작성)이 COMPLETED 세션을 잡고 있어도 철회는 기다리지 않는다. */
    @Test
    void 종료된_세션_잠금은_철회를_막지_않는다() throws Exception {
        long completed = runningSession();
        setStatus(completed, "COMPLETED");
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock =
                    holder.prepareStatement("SELECT id FROM running_sessions WHERE id=? FOR UPDATE")) {
                lock.setLong(1, completed);
                lock.executeQuery().close();
            }
            CompletableFuture<String> revoke = async(this::revoke);
            // 종료 세션을 잠그면 2초 잠금 대기 초과로 503이 된다. 시간 제한이 아닌 결과 값으로 판정한다.
            assertThat(revoke.get(10, TimeUnit.SECONDS)).isEqualTo("OK");
            holder.rollback();
        }
        assertThat(consent()).isEqualTo("DISAGREE");
    }

    /** 준비도 평가가 점수를 만들 수 있는 합성 입력(D-7~D-1 RHR 60, 오늘 66)을 두 회원에게 넣는다. */
    private LocalDate seedReadinessInputs() {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        for (long user : new long[] {userId, otherUserId}) {
            for (int i = 0; i <= 7; i++) {
                jdbc.update(
                        "INSERT INTO daily_health_metrics(user_id,metric_date,rhr_bpm,rhr_revision)"
                                + " VALUES (?,?,?,1)",
                        user,
                        today.minusDays(i),
                        new BigDecimal(i == 0 ? "66" : "60"));
            }
        }
        return today;
    }

    /** 다른 트랜잭션이 회원 행을 2초 넘게 잡고 있으면 W04는 503이고 값을 바꾸지 않는다. */
    @Test
    void 회원_행_잠금이_길면_503이다() throws Exception {
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock =
                    holder.prepareStatement("SELECT id FROM users WHERE id=? FOR UPDATE")) {
                lock.setLong(1, userId);
                lock.executeQuery().close();
            }
            mockMvc.perform(
                            post("/api/v1/consents")
                                    .header("Authorization", SecurityTestSupport.bearer(userId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"consentType\":\"HEALTH_DATA\",\"granted\":false}"))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
            holder.rollback();
        }
        assertThat(consent()).isEqualTo("AGREE");
    }

    /**
     * 철회를 한 트랜잭션 안에서 실행한 뒤 커밋 전에 action을 실행한다. action이 시작한 작업은 커밋 뒤에 결과를 낸다.
     */
    private <T> T whileRevokeOpen(Callable<T> action) {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        return tx.execute(
                s -> {
                    consentService.change(userId, false);
                    try {
                        return action.call();
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                });
    }

    private List<String> runTogether(List<Callable<String>> tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        CountDownLatch ready = new CountDownLatch(tasks.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<String>> futures = new ArrayList<>();
            for (Callable<String> task : tasks) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    return task.call();
                                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<String> results = new ArrayList<>();
            for (Future<String> future : futures) {
                results.add(future.get(30, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    /** 잠금을 기다리는 서로 다른 백엔드 프로세스가 expected개 이상인지 관찰한다. */
    private void waitForLockWaits(int expected) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer waiting =
                    jdbc.queryForObject(
                            "SELECT count(DISTINCT l.pid) FROM pg_locks l"
                                    + " JOIN pg_stat_activity a ON a.pid = l.pid"
                                    + " WHERE NOT l.granted AND a.datname = current_database()",
                            Integer.class);
            if (waiting != null && waiting >= expected) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("잠금 대기를 관찰하지 못했습니다.");
    }

    /** 다른 백엔드가 해당 문구를 포함한 문장을 실행 중인지 관찰한다. */
    private void waitForQuery(String fragment) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer running =
                    jdbc.queryForObject(
                            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()"
                                    + " AND state='active'"
                                    + " AND wait_event='PgSleep' AND pid<>pg_backend_pid()",
                            Integer.class);
            if (running != null && running > 0) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("실행 중인 " + fragment + "를 관찰하지 못했습니다.");
    }
}
