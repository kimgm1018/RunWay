package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.device.dto.request.SyncBatchRequest;
import com.runway.backend.domain.device.repository.SyncBatchJdbcRepository;
import com.runway.backend.domain.device.service.BatchPayloadHasher;
import com.runway.backend.domain.device.service.SyncBatchService;
import com.runway.backend.global.exception.ApiException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
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
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * AC-11·AC-12·AC-14. 동시에 출발시킨 요청이 실제 DB 트랜잭션에서 겹치도록 실행하고 응답 코드와 최종 DB 행으로 판정한다. 단일 서버·단일 DB 범위의
 * 확인이다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class SyncBatchConcurrencyIntegrationTest extends SyncBatchIntegrationSupport {

    private static final int THREADS = 8;

    @Autowired private SyncBatchService service;
    @Autowired private SyncBatchJdbcRepository repository;
    @Autowired private DataSource dataSource;
    @Autowired private PlatformTransactionManager transactionManager;

    private static SyncBatchRequest parse(String json) {
        return SyncBatchRequest.parse(json.getBytes(StandardCharsets.UTF_8));
    }

    private String commit(String json) {
        SyncBatchRequest request = parse(json);
        try {
            service.commit(userId, request, BatchPayloadHasher.verify(request));
            return "OK";
        } catch (ApiException e) {
            return e.code();
        }
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

    @RepeatedTest(10)
    void 같은_batch의_동시_재전송은_모두_ACK이고_원본은_한_번만_저장된다() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142), gps(1));
        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            tasks.add(() -> commit(body));
        }

        assertThat(runTogether(tasks)).containsOnly("OK").hasSize(THREADS);
        assertThat(count("SELECT count(*) FROM sync_batches")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_route_points")).isEqualTo(1);
    }

    @RepeatedTest(10)
    void 같은_ID의_서로_다른_내용이_동시에_오면_하나만_저장되고_나머지는_409() throws Exception {
        long sessionId = runningSession();
        String id = newBatchId();
        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            String body = batch(id, watchId, sessionId, metric(1, 140 + i));
            tasks.add(() -> commit(body));
        }

        List<String> results = runTogether(tasks);
        assertThat(results.stream().filter("OK"::equals)).hasSize(1);
        assertThat(results.stream().filter("BATCH_HASH_CONFLICT"::equals)).hasSize(THREADS - 1);
        assertThat(count("SELECT count(*) FROM sync_batches")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isEqualTo(1);
    }

    /**
     * 한 회원의 활성 세션은 하나라서 API로는 "다른 세션 + 같은 ID"를 동시에 만들 수 없다. 저장소의 ON CONFLICT 경로를 직접 겹쳐 실행해, 뒤 요청이 선행
     * 트랜잭션의 커밋을 기다린 뒤 삽입하지 않고 false를 반환하는지 확인한다.
     */
    @Test
    void 같은_키를_동시에_삽입하면_뒤_요청은_선행_커밋을_기다린_뒤_삽입하지_않는다() throws Exception {
        long first = runningSession();
        setStatus(first, "COMPLETED");
        long second = runningSession();
        UUID id = UUID.randomUUID();
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        CountDownLatch inserted = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);

        CompletableFuture<Boolean> leader =
                CompletableFuture.supplyAsync(
                        () ->
                                tx.execute(
                                        s -> {
                                            boolean ok =
                                                    repository.insertCommitted(
                                                            id, watchId, first, "1", "a".repeat(64));
                                            inserted.countDown();
                                            await(release);
                                            return ok;
                                        }));
        assertThat(inserted.await(10, TimeUnit.SECONDS)).isTrue();
        CompletableFuture<Boolean> follower =
                CompletableFuture.supplyAsync(
                        () ->
                                tx.execute(
                                        s ->
                                                repository.insertCommitted(
                                                        id, watchId, second, "1", "b".repeat(64))));
        waitForLockWait();
        assertThat(follower).isNotDone();
        release.countDown();

        assertThat(leader.get(10, TimeUnit.SECONDS)).isTrue();
        assertThat(follower.get(10, TimeUnit.SECONDS)).isFalse();
        assertThat(repository.findBatch(watchId, id))
                .get()
                .extracting(SyncBatchJdbcRepository.StoredBatch::sessionId)
                .isEqualTo(first);
    }

    /** AC-12·AC-17. 드라이버 오류 메시지의 좌표·측정값이 로그에 남지 않는지도 확인한다. */
    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void 원본_저장_중_DB가_실패하면_batch_기록과_원본이_모두_롤백되고_재전송으로_복구된다(CapturedOutput output)
            throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142), metric(2, 143), gps(2));
        jdbc.execute(
                "CREATE OR REPLACE FUNCTION test_fail_route_insert() RETURNS trigger AS $$"
                        + " BEGIN RAISE EXCEPTION 'synthetic failure'; END $$ LANGUAGE plpgsql");
        jdbc.execute(
                "CREATE TRIGGER test_fail_route BEFORE INSERT ON running_route_points"
                        + " FOR EACH ROW EXECUTE FUNCTION test_fail_route_insert()");
        try {
            mockMvc.perform(syncRequest(userId, body))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
            assertThat(storedRows()).isZero();
            assertThat(output.getAll())
                    .contains("W07 DB 처리 실패")
                    .doesNotContain("127.0012", "37.5034", "Batch entry", "synthetic failure");
        } finally {
            jdbc.execute("DROP TRIGGER test_fail_route ON running_route_points");
            jdbc.execute("DROP FUNCTION test_fail_route_insert()");
        }

        mockMvc.perform(syncRequest(userId, body)).andExpect(status().isOk());
        assertThat(count("SELECT count(*) FROM sync_batches")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isEqualTo(2);
        assertThat(count("SELECT count(*) FROM running_route_points")).isEqualTo(1);
    }

    @Test
    void 종료_확정이_세션을_잡고_있으면_W07은_기다린_뒤_새_batch를_거절한다() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));

        String result =
                whileSessionLocked(
                        sessionId,
                        "UPDATE running_sessions SET status='COMPLETED', ended_at=now() WHERE id=?",
                        () -> commit(body));

        assertThat(result).isEqualTo("INVALID_SESSION_STATE");
        assertThat(storedRows()).isZero();
    }

    @Test
    void 폰_인계가_세션을_잡고_있으면_W07은_기다린_뒤_이전_워치_batch를_거절한다() throws Exception {
        long sessionId = runningSession();
        insertCommand(sessionId, watchId, "START", 1, "APPLIED");
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));

        String result =
                whileSessionLocked(
                        sessionId,
                        "UPDATE running_sessions SET control_device_id=relay_device_id,"
                                + " state_version=state_version+1 WHERE id=?",
                        () -> commit(body));

        assertThat(result).isEqualTo("CONTROL_DEVICE_CHANGED");
        assertThat(storedRows()).isZero();
    }

    /**
     * W07이 세션 행을 잡은 채 기기 잠금을 기다리는 동안(W03 해제 트랜잭션이 기기 행을 잡은 상황) 종료 확정이 들어오면, 종료는 W07의 저장이 커밋될
     * 때까지 기다린다. 해제가 롤백되면 W07은 저장을 마치고 그 뒤에 종료가 반영된다.
     */
    @Test
    void W07이_먼저_세션을_잡으면_종료는_저장_완료_뒤에_진행된다() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock =
                    holder.prepareStatement("SELECT id FROM user_devices WHERE id=? FOR UPDATE")) {
                lock.setLong(1, watchId);
                lock.executeQuery().close();
            }
            CompletableFuture<String> w07 = CompletableFuture.supplyAsync(() -> commit(body));
            waitForLockWaits(1);
            CompletableFuture<Integer> end =
                    CompletableFuture.supplyAsync(
                            () ->
                                    jdbc.update(
                                            "UPDATE running_sessions SET status='COMPLETED', ended_at=now()"
                                                    + " WHERE id=?",
                                            sessionId));
            waitForLockWaits(2);
            assertThat(w07).isNotDone();
            assertThat(end).isNotDone();
            holder.rollback();

            assertThat(w07.get(10, TimeUnit.SECONDS)).isEqualTo("OK");
            assertThat(end.get(10, TimeUnit.SECONDS)).isEqualTo(1);
        }
        assertThat(count("SELECT count(*) FROM running_metric_samples WHERE running_session_id=?", sessionId))
                .isEqualTo(1);
        assertThat(commit(body)).isEqualTo("OK");
        assertThat(commit(batch(newBatchId(), watchId, sessionId, metric(2, 142))))
                .isEqualTo("INVALID_SESSION_STATE");
    }

    /**
     * 세션 잠금이 공통 잠금 대기 상한(S15P31E105-294, 기본 5초)보다 오래 잡혀 있으면 W07은 503이고 아무것도 저장하지 않는다. 잠금이 풀린 뒤 같은
     * 요청을 다시 보내면 저장된다.
     */
    @Test
    void 세션_잠금_대기가_상한을_넘으면_503이고_재전송으로_저장된다() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock =
                    holder.prepareStatement("SELECT id FROM running_sessions WHERE id=? FOR UPDATE")) {
                lock.setLong(1, sessionId);
                lock.executeQuery().close();
            }
            mockMvc.perform(syncRequest(userId, body))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
            assertThat(storedRows()).isZero();
            holder.rollback();
        }
        mockMvc.perform(syncRequest(userId, body)).andExpect(status().isOk());
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isEqualTo(1);
    }

    /** I-1 회귀. W07은 회원 행을 잠그지 않는다. 로그인·프로필 저장이 회원 행을 잡고 있어도 기다리지 않고 저장한다. */
    @Test
    void 회원_행이_잠겨_있어도_W07은_기다리지_않는다() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));
        assertThat(whileRowLocked("SELECT id FROM users WHERE id=? FOR UPDATE", userId, () -> commit(body)))
                .isEqualTo("OK");
    }

    /** I-7 회귀. 다른 회원의 기기 행은 잠그지 않는다. 그 행이 잠겨 있어도 기다리지 않고 403이다. */
    @Test
    void 타인_기기_행이_잠겨_있어도_기다리지_않고_403() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), otherWatchId, sessionId, metric(1, 142));
        assertThat(
                        whileRowLocked(
                                "SELECT id FROM user_devices WHERE id=? FOR UPDATE",
                                otherWatchId,
                                () -> commit(body)))
                .isEqualTo("DEVICE_FORBIDDEN");
    }

    /** R-1. 세션 잠금을 기다리는 동안 커밋된 동의 철회는 반영한다(동의를 잠금 뒤에 다시 읽는다). */
    @Test
    void 세션_잠금_대기_중_커밋된_동의_철회를_반영한다() throws Exception {
        long sessionId = runningSession();
        String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));

        String result =
                whileSessionLocked(
                        sessionId,
                        "UPDATE users SET health_data_access='DISAGREE'"
                                + " WHERE id=(SELECT user_id FROM running_sessions WHERE id=?)",
                        () -> commit(body));

        assertThat(result).isEqualTo("CONSENT_REQUIRED");
        assertThat(storedRows()).isZero();
    }

    /** 다른 커넥션이 행을 잠근 상태에서 요청이 5초 안에 끝나는지 본다. 잠금을 기다리면 시간 초과로 실패한다. */
    private String whileRowLocked(String lockSql, long id, Callable<String> request) throws Exception {
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock = holder.prepareStatement(lockSql)) {
                lock.setLong(1, id);
                lock.executeQuery().close();
            }
            CompletableFuture<String> pending =
                    CompletableFuture.supplyAsync(
                            () -> {
                                try {
                                    return request.call();
                                } catch (Exception e) {
                                    throw new IllegalStateException(e);
                                }
                            });
            try {
                return pending.get(5, TimeUnit.SECONDS);
            } finally {
                holder.rollback();
            }
        }
    }

    /**
     * 서비스 수준 ON CONFLICT 경로. 다른 트랜잭션이 같은 (기기, batch ID)를 다른 세션으로 삽입하고 아직 커밋하지 않은 상태에서 W07이 들어오면, W07은
     * 기존 행을 못 본 채 삽입에서 기다린다. 선행 트랜잭션이 커밋되면 내용이 다르므로 409이고 원본은 저장되지 않는다.
     */
    @Test
    void 다른_세션의_같은_ID가_먼저_커밋되면_409이고_원본을_저장하지_않는다() throws Exception {
        String result = whileBatchInsertPending(true);
        assertThat(result).isEqualTo("BATCH_HASH_CONFLICT");
        assertThat(count("SELECT count(*) FROM sync_batches")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isZero();
    }

    @Test
    void 다른_세션의_같은_ID가_롤백되면_W07이_저장한다() throws Exception {
        String result = whileBatchInsertPending(false);
        assertThat(result).isEqualTo("OK");
        assertThat(count("SELECT count(*) FROM sync_batches")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM running_metric_samples")).isEqualTo(1);
    }

    private String whileBatchInsertPending(boolean commitFirst) throws Exception {
        long earlier = runningSession();
        setStatus(earlier, "COMPLETED");
        long current = runningSession();
        String id = newBatchId();
        String body = batch(id, watchId, current, metric(1, 142));
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement insert =
                    holder.prepareStatement(
                            "INSERT INTO sync_batches(client_batch_id,device_id,session_id,payload_version,"
                                    + "payload_hash,status,committed_at)"
                                    + " VALUES (?::uuid,?,?,'1',?,'COMMITTED',now())")) {
                insert.setString(1, id);
                insert.setLong(2, watchId);
                insert.setLong(3, earlier);
                insert.setString(4, "c".repeat(64));
                insert.executeUpdate();
            }
            CompletableFuture<String> w07 = CompletableFuture.supplyAsync(() -> commit(body));
            waitForLockWaits(1);
            assertThat(w07).isNotDone();
            if (commitFirst) {
                holder.commit();
            } else {
                holder.rollback();
            }
            return w07.get(10, TimeUnit.SECONDS);
        }
    }

    /**
     * 별도 커넥션이 세션 행을 잠근 상태에서 W07을 시작하고, W07이 잠금 대기에 들어간 것을 확인한 뒤 상태를 바꿔 커밋한다. 순차 요청과 구분하기 위해
     * pg_locks에서 대기를 관찰한다.
     */
    private String whileSessionLocked(long sessionId, String change, Callable<String> request)
            throws Exception {
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock =
                    holder.prepareStatement("SELECT id FROM running_sessions WHERE id=? FOR UPDATE")) {
                lock.setLong(1, sessionId);
                lock.executeQuery().close();
            }
            CompletableFuture<String> pending =
                    CompletableFuture.supplyAsync(
                            () -> {
                                try {
                                    return request.call();
                                } catch (Exception e) {
                                    throw new IllegalStateException(e);
                                }
                            });
            waitForLockWait();
            assertThat(pending).isNotDone();
            try (PreparedStatement update = holder.prepareStatement(change)) {
                update.setLong(1, sessionId);
                update.executeUpdate();
            }
            holder.commit();
            return pending.get(10, TimeUnit.SECONDS);
        }
    }

    private void waitForLockWait() throws InterruptedException {
        waitForLockWaits(1);
    }

    /** 잠금을 기다리는 서로 다른 백엔드 프로세스가 expected개 이상인지 관찰한다. */
    private void waitForLockWaits(int expected) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer waiting =
                    jdbc.queryForObject(
                            "SELECT count(DISTINCT pid) FROM pg_locks WHERE NOT granted", Integer.class);
            if (waiting != null && waiting >= expected) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("잠금 대기를 관찰하지 못했습니다.");
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("timeout");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
