package com.runway.backend.domain.session.service;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * 종료 후 분석 전용 실행기. END 요청 스레드가 커밋 직후 분석을 넘기고 바로 응답하도록 별도 스레드에서 {@link
 * PostRunAnalysisService#analyze(long)}를 실행한다.
 *
 * <p>실행기는 이 클래스가 직접 만들고 닫는다. Executor 타입 Bean으로 노출하면 Spring Boot 기본 실행기 자동 구성이 꺼지고 전역 비동기 설정도 쓰지 않으므로
 * 준비도 평가 실행기와 같은 방식이다. 대기열이 차면 요청 스레드에서 직접 실행해 분석이 유실되지 않게 한다.
 */
@Component
public class PostRunAnalysisDispatcher implements DisposableBean {

    static final int THREADS = 2;
    static final int QUEUE_CAPACITY = 1000;
    static final int SHUTDOWN_WAIT_SECONDS = 10;

    private static final Logger log = LoggerFactory.getLogger(PostRunAnalysisDispatcher.class);

    private final PostRunAnalysisService analysisService;
    private final ThreadPoolTaskExecutor executor;

    /** 넣었지만 아직 끝나지 않은 분석 수. 실행기 내부 수치는 작업을 꺼낸 직후 잠시 0이 될 수 있어 직접 센다. */
    private final AtomicInteger pending = new AtomicInteger();

    public PostRunAnalysisDispatcher(PostRunAnalysisService analysisService) {
        this.analysisService = analysisService;
        this.executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(THREADS);
        executor.setMaxPoolSize(THREADS);
        executor.setQueueCapacity(QUEUE_CAPACITY);
        executor.setThreadNamePrefix("post-run-analysis-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(SHUTDOWN_WAIT_SECONDS);
        executor.initialize();
    }

    /** 분석을 대기열에 넣는다. 호출 스레드에서 DB를 쓰지 않는다(대기열 초과 시에만 직접 실행). */
    public void dispatch(long sessionId) {
        pending.incrementAndGet();
        try {
            executor.execute(() -> run(sessionId));
        } catch (TaskRejectedException e) {
            log.warn("종료 후 분석 대기열 초과 또는 종료 중이라 호출 스레드에서 실행 (sessionId={})", sessionId);
            run(sessionId);
        }
    }

    private void run(long sessionId) {
        try {
            analysisService.analyze(sessionId);
        } catch (RuntimeException e) {
            log.error(
                    "종료 후 분석 실행 오류 (sessionId={}, {})", sessionId, e.getClass().getSimpleName());
        } finally {
            pending.decrementAndGet();
        }
    }

    /**
     * 대기열과 실행 중인 분석이 모두 끝날 때까지 기다린다. 테스트와 운영 점검에서 분석 완료를 확인할 때 쓴다.
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
}
