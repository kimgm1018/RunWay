package com.runway.backend.domain.coaching.service;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import com.runway.backend.domain.session.service.SessionCoachingService;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;

import jakarta.annotation.PreDestroy;

import lombok.extern.slf4j.Slf4j;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * 새 batch 저장 커밋 뒤 코칭 발행 조건을 판단한다(pace-coaching.md "서버는 새 배치 저장 후 최신 입력으로 코칭 필요 여부를 판단"). W07 응답을 늦추지
 * 않도록 자체 단일 스레드에서 실행한다. 전역 Executor 빈·@EnableAsync를 만들지 않는 기존 Dispatcher 방식을 따른다.
 */
@Slf4j
@Component
public class CoachingTrigger {

    private final SessionCoachingService coachingService;
    private final SessionStreamRegistry streams;
    private final ExecutorService executor =
            Executors.newSingleThreadExecutor(
                    runnable -> {
                        Thread thread = new Thread(runnable, "coaching-trigger");
                        thread.setDaemon(true);
                        return thread;
                    });

    public CoachingTrigger(SessionCoachingService coachingService, SessionStreamRegistry streams) {
        this.coachingService = coachingService;
        this.streams = streams;
    }

    /** 판단을 기다리는 세션. 같은 세션의 batch가 몰려도 대기열에는 한 번만 넣는다(최신 상태로 한 번 판단하면 충분하다). */
    private final Set<Long> queued = ConcurrentHashMap.newKeySet();

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void onBatchCommitted(RunningBatchCommittedEvent event) {
        long sessionId = event.sessionId();
        if (!queued.add(sessionId)) {
            return;
        }
        try {
            executor.execute(
                    () -> {
                        // 판단 직전에 빼서, 판단 중에 저장된 batch는 다음 판단을 다시 예약하게 한다.
                        queued.remove(sessionId);
                        evaluate(sessionId);
                    });
        } catch (RejectedExecutionException e) {
            // 종료 중이다. 다음 batch에서 다시 판단한다.
            queued.remove(sessionId);
        }
    }

    /**
     * 폰의 S10 구독이 없으면 코칭을 워치에 전달할 수 없으므로 발행하지 않는다(sessions.md S10 "연결 오류 중 자동 코칭 중단", 리뷰 R-2 2026-11-05
     * 확정). 전달할 수 없는 미확정 명령이 사용자 조작을 막지 않게 한다.
     */
    void evaluate(long sessionId) {
        if (streams.subscriberCount(sessionId) == 0) {
            return;
        }
        try {
            coachingService.issueIfDue(sessionId);
        } catch (RuntimeException e) {
            // 다른 제어와 겹쳐 제약에 걸렸거나 저장에 실패했다. 다음 batch에서 다시 판단한다. 측정값은 로그에 남기지 않는다.
            log.warn("코칭 발행 판단 실패 (sessionId={}, {})", sessionId, e.getClass().getSimpleName());
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
