package com.runway.backend.domain.user.service;

import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * 심박 개인화(AI06) 전용 실행기. END 요청 스레드가 커밋 직후 작업을 넘기고 바로 응답하도록 별도 스레드에서 {@link
 * HrPersonalizationRunService}를 실행한다.
 *
 * <p>같은 회원은 인메모리로 직렬화한다. 이미 실행 중인 회원의 요청은 새 작업을 만들지 않고 "끝난 뒤 한 번 더" 표시만 남기며, 실행 중이던 작업이 끝나면 최신 러닝을
 * 반영해 한 번 더 실행한다. 재기동하면 대기·표시는 사라진다(허용).
 *
 * <p>AI 호출은 최대 수 분 걸릴 수 있어 대기열이 가득 차면 요청 스레드에서 실행하지 않고 버린다(재전달 없음). 실행기는 이 클래스가 직접 만들고 닫는다.
 */
@Component
public class HrPersonalizationDispatcher implements DisposableBean {

    static final int THREADS = 2;
    static final int QUEUE_CAPACITY = 200;
    static final int SHUTDOWN_WAIT_SECONDS = 10;
    static final int KEEP_ALIVE_SECONDS = 60;

    private static final Logger log = LoggerFactory.getLogger(HrPersonalizationDispatcher.class);

    private final HrPersonalizationRunService runService;
    private final ThreadPoolTaskExecutor executor;

    /** 실행 중인 회원. 값은 "끝난 뒤 한 번 더" 표시이며 {@code compute} 안에서만 읽고 쓴다. */
    private final ConcurrentHashMap<Long, UserState> active = new ConcurrentHashMap<>();

    /** 넣었지만 아직 끝나지 않은 작업 수. 실행기 내부 수치는 작업을 꺼낸 직후 잠시 0이 될 수 있어 직접 센다. */
    private final AtomicInteger pending = new AtomicInteger();

    public HrPersonalizationDispatcher(HrPersonalizationRunService runService) {
        this.runService = runService;
        this.executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(THREADS);
        executor.setMaxPoolSize(THREADS);
        executor.setQueueCapacity(QUEUE_CAPACITY);
        executor.setKeepAliveSeconds(KEEP_ALIVE_SECONDS);
        // 한가할 때는 스레드를 0개까지 줄인다(실질 1~2개).
        executor.setAllowCoreThreadTimeOut(true);
        executor.setThreadNamePrefix("hr-personalization-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(SHUTDOWN_WAIT_SECONDS);
        executor.initialize();
    }

    /** 작업을 대기열에 넣는다. 호출 스레드에서 DB·HTTP를 하지 않는다. 대기열 초과·종료 중이면 버리고 경고만 남긴다. */
    public void dispatch(long sessionId) {
        pending.incrementAndGet();
        try {
            executor.execute(() -> run(sessionId));
        } catch (TaskRejectedException e) {
            pending.decrementAndGet();
            log.warn("HR personalization 대기열 초과 또는 종료 중이라 건너뜀 (sessionId={})", sessionId);
        }
    }

    private void run(long sessionId) {
        try {
            Optional<Long> userId = runService.findUserId(sessionId);
            if (userId.isEmpty()) {
                log.warn("HR personalization 세션을 찾지 못함 (sessionId={})", sessionId);
                return;
            }
            runSerialized(userId.get());
        } catch (RuntimeException e) {
            // DB 예외 메시지에 값이 들어 있을 수 있어 클래스 이름만 남긴다.
            log.error(
                    "HR personalization 실행 오류 (sessionId={}, {})",
                    sessionId,
                    e.getClass().getSimpleName());
        } finally {
            pending.decrementAndGet();
        }
    }

    private void runSerialized(long userId) {
        boolean[] owner = {false};
        active.compute(
                userId,
                (id, state) -> {
                    if (state == null) {
                        owner[0] = true;
                        return new UserState();
                    }
                    state.rerun = true;
                    return state;
                });
        if (!owner[0]) {
            log.debug("HR personalization 이미 실행 중이라 끝난 뒤 한 번 더 실행 (userId={})", userId);
            return;
        }
        boolean[] again = {false};
        do {
            again[0] = false;
            try {
                runService.runForUser(userId);
            } catch (RuntimeException e) {
                log.error(
                        "HR personalization 회원 실행 오류 (userId={}, {})",
                        userId,
                        e.getClass().getSimpleName());
            } finally {
                // Error가 나와도 회원 슬롯을 비운다. 실행 중 새 요청이 있었으면 표시를 내리고 한 번 더 돌린다.
                active.compute(
                        userId,
                        (id, state) -> {
                            if (state != null && state.rerun) {
                                state.rerun = false;
                                again[0] = true;
                                return state;
                            }
                            return null;
                        });
            }
        } while (again[0]);
    }

    /**
     * 대기열과 실행 중인 작업이 모두 끝날 때까지 기다린다. 테스트와 운영 점검에서 완료를 확인할 때 쓴다.
     *
     * @return 제한 시간 안에 비었으면 true
     */
    public boolean awaitIdle(Duration timeout) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (pending.get() > 0) {
            if (System.nanoTime() >= deadline) {
                return false;
            }
            Thread.sleep(10);
        }
        return true;
    }

    @Override
    public void destroy() {
        executor.shutdown();
    }

    private static final class UserState {
        boolean rerun;
    }
}
