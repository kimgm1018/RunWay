package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest;
import com.runway.backend.domain.device.dto.response.HealthRecordSyncResponse;
import com.runway.backend.domain.device.service.HealthRecordSyncService;
import com.runway.backend.global.exception.ApiException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.LocalDate;
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
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * W06 AC-6·AC-8. 동시에 출발시킨 요청과 동의 철회가 실제 DB 트랜잭션에서 겹치도록 실행하고 응답과 최종 DB 행으로 판정한다. 단일 서버·단일 DB 범위의
 * 확인이다. 철회는 회원 행 UPDATE로 재현한다. W04 실제 서비스와의 경합은 ConsentConcurrencyIntegrationTest가 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class HealthRecordSyncConcurrencyIntegrationTest extends HealthRecordSyncIntegrationSupport {

    @Autowired private HealthRecordSyncService service;
    @Autowired private DataSource dataSource;

    private String sync(long user, int revision, String bpm) {
        String body = healthBody(estimate(today(), revision, bpm));
        HealthRecordSyncRequest request =
                HealthRecordSyncRequest.parse(body.getBytes(StandardCharsets.UTF_8), today());
        try {
            HealthRecordSyncResponse response = service.sync(user, request);
            return response.acceptedCount() == 1 ? "ACCEPTED" : "DUPLICATE";
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

    @RepeatedTest(20)
    void 같은_날짜의_서로_다른_revision이_동시에_와도_최종값은_가장_큰_revision이다() throws Exception {
        List<String> results =
                runTogether(
                        List.of(
                                () -> sync(userId, 3, "58.4"),
                                () -> sync(userId, 4, "57.9"),
                                () -> sync(userId, 2, "60.0")));

        assertThat(results).doesNotContain("CONSENT_REQUIRED", "UNAUTHORIZED");
        assertThat(count("SELECT count(*) FROM daily_health_metrics")).isEqualTo(1);
        assertThat(metricRows(userId, today()).get(0)).containsEntry("rhr_revision", 4);
        assertThat(results.get(1)).isEqualTo("ACCEPTED");
    }

    @RepeatedTest(10)
    void 같은_요청이_동시에_와도_한_행만_남고_하나만_accepted다() throws Exception {
        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            tasks.add(() -> sync(userId, 5, "58.4"));
        }

        List<String> results = runTogether(tasks);

        assertThat(results).containsOnly("ACCEPTED", "DUPLICATE");
        assertThat(results.stream().filter("ACCEPTED"::equals)).hasSize(1);
        assertThat(count("SELECT count(*) FROM daily_health_metrics")).isEqualTo(1);
    }

    /**
     * 같은 회원이 날짜 순서가 반대인 두 요청을 동시에 보내도 서버가 날짜 오름차순으로 저장하므로 서로의 행을 기다리는 교착(40P01, 503)이 생기지 않는다.
     */
    @RepeatedTest(20)
    void 같은_회원의_날짜_순서가_반대인_동시_요청도_교착_없이_모두_저장된다() throws Exception {
        LocalDate a = today().minusDays(2);
        LocalDate b = today().minusDays(1);
        LocalDate c = today();
        String forward =
                healthBody(estimate(a, 1, "58.0"), estimate(b, 1, "58.1"), estimate(c, 1, "58.2"));
        String backward =
                healthBody(estimate(c, 2, "57.2"), estimate(b, 2, "57.1"), estimate(a, 2, "57.0"));

        List<String> results =
                runTogether(List.of(() -> syncBody(userId, forward), () -> syncBody(userId, backward)));

        assertThat(results).containsOnly("OK");
        assertThat(count("SELECT count(*) FROM daily_health_metrics WHERE rhr_revision=2"))
                .isEqualTo(3);
    }

    private String syncBody(long user, String body) {
        HealthRecordSyncRequest request =
                HealthRecordSyncRequest.parse(body.getBytes(StandardCharsets.UTF_8), today());
        try {
            service.sync(user, request);
            return "OK";
        } catch (ApiException e) {
            return e.code();
        } catch (RuntimeException e) {
            return e.getClass().getSimpleName();
        }
    }

    /** 철회 트랜잭션이 회원 행을 잡고 있으면 W06은 기다렸다가 커밋된 철회를 읽고 403으로 끝난다. */
    @Test
    void 먼저_시작한_동의_철회가_커밋되면_기다리던_W06은_저장하지_않는다() throws Exception {
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement withdraw =
                    holder.prepareStatement(
                            "UPDATE users SET health_data_access='DISAGREE' WHERE id=?")) {
                withdraw.setLong(1, userId);
                withdraw.executeUpdate();
            }
            CompletableFuture<String> w06 =
                    CompletableFuture.supplyAsync(() -> sync(userId, 1, "58.4"));
            waitForLockWait();
            assertThat(w06).isNotDone();
            holder.commit();

            assertThat(w06.get(10, TimeUnit.SECONDS)).isEqualTo("CONSENT_REQUIRED");
        }
        assertThat(healthRows()).isZero();
    }

    /** 철회 트랜잭션이 롤백되면 기다리던 W06은 기존 동의로 저장한다. */
    @Test
    void 기다리던_동의_철회가_롤백되면_W06은_저장한다() throws Exception {
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement withdraw =
                    holder.prepareStatement(
                            "UPDATE users SET health_data_access='DISAGREE' WHERE id=?")) {
                withdraw.setLong(1, userId);
                withdraw.executeUpdate();
            }
            CompletableFuture<String> w06 =
                    CompletableFuture.supplyAsync(() -> sync(userId, 1, "58.4"));
            waitForLockWait();
            holder.rollback();

            assertThat(w06.get(10, TimeUnit.SECONDS)).isEqualTo("ACCEPTED");
        }
        assertThat(healthRows()).isEqualTo(1);
    }

    /**
     * W06이 회원 행을 잡은 뒤 저장 중이면(테스트 트리거로 저장을 1.5초 늦춤) 동의 철회는 W06 커밋 뒤에 진행된다. 저장된 값은 철회 전에 확정된 것이다.
     */
    @Test
    void W06이_먼저_회원_행을_잡으면_동의_철회는_저장_커밋_뒤에_진행된다() throws Exception {
        jdbc.execute(
                "CREATE OR REPLACE FUNCTION test_slow_health_insert() RETURNS trigger AS $$"
                        + " BEGIN PERFORM pg_sleep(1.5); RETURN NEW; END $$ LANGUAGE plpgsql");
        jdbc.execute(
                "CREATE TRIGGER test_slow_health BEFORE INSERT ON daily_health_metrics"
                        + " FOR EACH ROW EXECUTE FUNCTION test_slow_health_insert()");
        try {
            CompletableFuture<String> w06 =
                    CompletableFuture.supplyAsync(() -> sync(userId, 1, "58.4"));
            waitForSleepingInsert();
            CompletableFuture<Integer> withdraw =
                    CompletableFuture.supplyAsync(
                            () ->
                                    jdbc.update(
                                            "UPDATE users SET health_data_access='DISAGREE' WHERE id=?",
                                            userId));
            // 저장 지연 중 새로 생긴 잠금 대기는 철회 UPDATE뿐이다(W06은 대기 없이 pg_sleep 중).
            waitForLockWait();
            assertThat(withdraw).isNotDone();
            assertThat(w06).isNotDone();

            assertThat(w06.get(10, TimeUnit.SECONDS)).isEqualTo("ACCEPTED");
            assertThat(withdraw.get(10, TimeUnit.SECONDS)).isEqualTo(1);
        } finally {
            jdbc.execute("DROP TRIGGER test_slow_health ON daily_health_metrics");
            jdbc.execute("DROP FUNCTION test_slow_health_insert()");
        }
        assertThat(metricRows(userId, today())).hasSize(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT health_data_access::text FROM users WHERE id=?",
                                String.class,
                                userId))
                .isEqualTo("DISAGREE");
    }

    @Test
    void 다른_회원의_동의_철회는_W06을_기다리게_하지_않는다() throws Exception {
        LocalDate date = today();
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement withdraw =
                    holder.prepareStatement(
                            "UPDATE users SET health_data_access='DISAGREE' WHERE id=?")) {
                withdraw.setLong(1, otherUserId);
                withdraw.executeUpdate();
            }
            assertThat(
                            CompletableFuture.supplyAsync(() -> sync(userId, 1, "58.4"))
                                    .get(5, TimeUnit.SECONDS))
                    .isEqualTo("ACCEPTED");
            holder.rollback();
        }
        assertThat(metricRows(userId, date)).hasSize(1);
    }

    private void waitForLockWait() throws InterruptedException {
        waitUntil("SELECT count(DISTINCT pid) FROM pg_locks WHERE NOT granted", "잠금 대기");
    }

    private void waitForSleepingInsert() throws InterruptedException {
        waitUntil(
                "SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep'",
                "W06 저장 지연");
    }

    private void waitUntil(String countSql, String what) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer n = jdbc.queryForObject(countSql, Integer.class);
            if (n != null && n >= 1) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError(what + "을(를) 관찰하지 못했습니다.");
    }
}
