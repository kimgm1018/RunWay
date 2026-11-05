package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.readiness.formula.ReadinessScore;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import com.runway.backend.domain.readiness.service.ReadinessEvaluationService;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * 254 AC-8. 같은 회원·날짜 평가를 실제 DB 트랜잭션에서 겹치게 실행한다. 단일 서버·단일 DB 범위의 확인이다.
 */
@Testcontainers
class ReadinessEvaluationConcurrencyIntegrationTest extends ReadinessIntegrationSupport {

    @Autowired private ReadinessEvaluationService evaluationService;
    @Autowired private ReadinessJdbcRepository repository;

    @RepeatedTest(5)
    void 같은_날짜_동시_평가는_행_하나로_끝난다() throws Exception {
        LocalDate date = today();
        insertRestingHr(userId, date, "66");
        insertBaseline(userId, date, 7, "60");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Optional<ReadinessScore>>> results =
                    List.of(
                            pool.submit(() -> awaitThen(start, () -> evaluationService.evaluate(userId, date))),
                            pool.submit(() -> awaitThen(start, () -> evaluationService.evaluate(userId, date))));
            start.countDown();
            for (Future<Optional<ReadinessScore>> result : results) {
                assertThat(result.get(30, TimeUnit.SECONDS)).isPresent();
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(readinessRows(userId)).hasSize(1);
        assertThat((BigDecimal) readinessRows(userId).getFirst().get("readiness_score"))
                .isEqualByComparingTo("65.00");
    }

    /**
     * 실행 순서를 강제한다. ① 오래된 평가가 잠금을 잡고 옛 값(66)을 읽은 직후 멈춘다. ② W06이 60(revision 2)으로 커밋하고, 커밋 후 평가가 같은 회원
     * 잠금에서 기다리는 것을 pg_locks로 확인한다. ③ 오래된 평가를 풀어 65를 쓰게 한다. ④ 기다리던 평가가 최신 값으로 100을 쓴다. 회원별 잠금이
     * 없으면 ②의 대기가 생기지 않아 실패하고, 순서가 뒤집혀 최종 65가 남는다.
     */
    @Test
    void W06_갱신과_겹친_평가가_오래된_값으로_덮어쓰지_않는다() throws Exception {
        LocalDate date = today();
        insertBaseline(userId, date, 7, "60");
        jdbc.update(
                "INSERT INTO daily_health_metrics(user_id,metric_date,rhr_bpm,rhr_revision) VALUES (?,?,66,1)",
                userId,
                date);
        AtomicReference<Thread> staleThread = new AtomicReference<>();
        CountDownLatch staleRead = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        doAnswer(
                        invocation -> {
                            Object inputs = invocation.callRealMethod();
                            if (Thread.currentThread() == staleThread.get()) {
                                staleRead.countDown();
                                assertThat(release.await(30, TimeUnit.SECONDS)).isTrue();
                            }
                            return inputs;
                        })
                .when(repository)
                .findHealthInputs(anyLong(), any(), any());
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<Optional<ReadinessScore>> stale =
                    pool.submit(
                            () -> {
                                staleThread.set(Thread.currentThread());
                                return evaluationService.evaluate(userId, date);
                            });
            assertThat(staleRead.await(30, TimeUnit.SECONDS)).isTrue();

            mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 2, "60"))))
                    .andExpect(status().isOk());
            assertThat(waitForBlockedEvaluation(Duration.ofSeconds(30))).isTrue();

            release.countDown();
            assertThat(stale.get(30, TimeUnit.SECONDS).orElseThrow().readinessScore())
                    .isEqualByComparingTo("65.00");
            awaitEvaluations();
        } finally {
            release.countDown();
            pool.shutdownNow();
        }

        assertThat(readinessRows(userId)).hasSize(1);
        assertThat((BigDecimal) readinessRows(userId).getFirst().get("readiness_score"))
                .isEqualByComparingTo("100.00");
    }

    /** 준비도 평가 advisory lock(첫 키 254001)을 기다리는 세션이 생길 때까지 기다린다. */
    private boolean waitForBlockedEvaluation(Duration timeout) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            Integer waiting =
                    jdbc.queryForObject(
                            "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=254001 AND NOT granted"
                                    + " AND database = (SELECT oid FROM pg_database"
                                    + " WHERE datname = current_database())",
                            Integer.class);
            if (waiting != null && waiting > 0) {
                return true;
            }
            Thread.sleep(20);
        }
        return false;
    }

    private static <T> T awaitThen(CountDownLatch start, ThrowingSupplier<T> action) throws Exception {
        start.await(10, TimeUnit.SECONDS);
        return action.get();
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws Exception;
    }
}
