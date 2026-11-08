package com.runway.backend.domain.coaching.service;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import com.runway.backend.domain.session.service.SessionCoachingService;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;

import jakarta.annotation.PreDestroy;

import lombok.extern.slf4j.Slf4j;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 새 batch 저장 커밋 뒤 AI04 코칭 판단을 실행한다(pace-coaching.md "서버는 새 배치 저장 후 최신 입력으로 코칭 필요 여부를 판단"). W07 응답을
 * 늦추지 않도록 자체 스레드에서 실행한다. 전역 Executor 빈·@EnableAsync를 만들지 않는 기존 Dispatcher 방식을 따른다.
 *
 * <ul>
 *   <li>세션 간에는 {@link #THREADS}개 스레드로 병렬 판단한다. AI 응답을 기다리는 세션이 다른 세션 판단을 막지 않게 한다.
 *   <li>같은 세션은 한 번에 하나만 판단한다. 판단 중에 온 batch는 모아 두었다가 끝난 뒤 한 번만 다시 판단한다(pace-coaching.md "계산 중
 *       들어온 새 입력은 다음 계산에 반영").
 *   <li>세션별 AI04 호출은 직전 호출 시작 후 {@link #MIN_CALL_INTERVAL}이 지나야 다시 한다(AI 서버 부하 제한, 2026-11-05 사용자 확정).
 *       기록은 메모리에만 두며 서버 재시작 시 초기화된다.
 * </ul>
 */
@Slf4j
@Component
public class CoachingTrigger {

    static final int THREADS = 2;

    static final Duration MIN_CALL_INTERVAL = Duration.ofSeconds(15);

    private final SessionCoachingService coachingService;
    private final SessionStreamRegistry streams;
    private final ExecutorService executor;

    /** 실행을 기다리거나 실행 중인 세션. */
    private final Set<Long> busy = ConcurrentHashMap.newKeySet();

    /** 판단 중에 새 batch가 온 세션. 판단이 끝나면 한 번 더 판단한다. */
    private final Set<Long> again = ConcurrentHashMap.newKeySet();

    /** 세션별 마지막 AI04 호출 시작 시각(System.nanoTime). */
    private final Map<Long, Long> lastCallNanos = new ConcurrentHashMap<>();

    public CoachingTrigger(SessionCoachingService coachingService, SessionStreamRegistry streams) {
        this.coachingService = coachingService;
        this.streams = streams;
        AtomicInteger seq = new AtomicInteger();
        this.executor =
                Executors.newFixedThreadPool(
                        THREADS,
                        runnable -> {
                            Thread thread =
                                    new Thread(runnable, "coaching-trigger-" + seq.incrementAndGet());
                            thread.setDaemon(true);
                            return thread;
                        });
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void onBatchCommitted(RunningBatchCommittedEvent event) {
        long sessionId = event.sessionId();
        if (!busy.add(sessionId)) {
            again.add(sessionId);
            // 그 사이 판단이 끝나 busy가 비었으면 직접 예약한다.
            if (busy.add(sessionId)) {
                again.remove(sessionId);
                submit(sessionId);
            }
            return;
        }
        submit(sessionId);
    }

    private void submit(long sessionId) {
        try {
            executor.execute(
                    () -> {
                        try {
                            evaluate(sessionId);
                        } finally {
                            busy.remove(sessionId);
                        }
                        if (again.remove(sessionId) && busy.add(sessionId)) {
                            submit(sessionId);
                        }
                    });
        } catch (RejectedExecutionException e) {
            // 종료 중이다. 다음 batch에서 다시 판단한다.
            busy.remove(sessionId);
            again.remove(sessionId);
        }
    }

    /**
     * 폰의 S10 구독이 없으면 코칭을 워치에 전달할 수 없으므로 판단하지 않는다(sessions.md S10 "연결 오류 중 자동 코칭 중단", 257 리뷰 R-2). 전달할
     * 수 없는 미확정 명령이 사용자 조작을 막지 않게 한다.
     */
    void evaluate(long sessionId) {
        if (streams.subscriberCount(sessionId) == 0 || recentlyCalled(sessionId)) {
            // 15초 안에 이미 불렀으면 입력 조회도 하지 않는다(리뷰 B-2).
            return;
        }
        try {
            coachingService.issueIfDue(sessionId, () -> tryAcquireCall(sessionId));
        } catch (RuntimeException e) {
            // 다른 제어와 겹쳐 제약에 걸렸거나 저장에 실패했다. 다음 batch에서 다시 판단한다. 측정값은 로그에 남기지 않는다.
            log.warn("코칭 발행 판단 실패 (sessionId={}, {})", sessionId, e.getClass().getSimpleName());
        }
    }

    boolean recentlyCalled(long sessionId) {
        Long last = lastCallNanos.get(sessionId);
        return last != null && System.nanoTime() - last < MIN_CALL_INTERVAL.toNanos();
    }

    /** 직전 호출에서 15초가 지났으면 이번 호출 시각을 기록하고 허가한다. 같은 세션은 동시에 실행되지 않는다. */
    boolean tryAcquireCall(long sessionId) {
        long now = System.nanoTime();
        Long last = lastCallNanos.get(sessionId);
        if (last != null && now - last < MIN_CALL_INTERVAL.toNanos()) {
            return false;
        }
        if (lastCallNanos.size() >= STALE_SWEEP_SIZE) {
            // 끝난 세션의 기록이 쌓이지 않게 15초보다 오래된 기록을 지운다. 지워도 판단 결과는 같다.
            long cutoff = now - MIN_CALL_INTERVAL.toNanos();
            lastCallNanos.values().removeIf(at -> at < cutoff);
        }
        lastCallNanos.put(sessionId, now);
        return true;
    }

    private static final int STALE_SWEEP_SIZE = 1024;

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
