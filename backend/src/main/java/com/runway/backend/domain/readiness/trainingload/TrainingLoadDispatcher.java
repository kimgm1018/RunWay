package com.runway.backend.domain.readiness.trainingload;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * 러닝 부하 저장 전용 실행기(S15P31E105-599 플랜 3.3). 종료 후 분석·S09 삭제 커밋 직후 호출 스레드가 바로 돌아가도록 부하 저장을 별도 스레드에서
 * 실행한다. 호출 스레드는 DB 커넥션을 더 잡지 않고, 삭제 응답이 부하 재계산·잠금 대기를 기다리지 않는다.
 *
 * <p>준비도 실행기와 같은 이유로 Bean으로 노출하지 않는 내부 실행기를 쓴다. 스레드 {@value #THREADS}개, 대기열 {@value #QUEUE_CAPACITY}건.
 * 대기열이 차면 그 세션은 건너뛰고 세션 ID만 로그로 남긴다(재전달 없음). 종료 시 대기 작업을 최대 {@value #SHUTDOWN_WAIT_SECONDS}초 기다린다.
 */
@Component
public class TrainingLoadDispatcher implements DisposableBean {

    static final int THREADS = 1;
    static final int QUEUE_CAPACITY = 1000;
    static final int SHUTDOWN_WAIT_SECONDS = 10;

    private static final Logger log = LoggerFactory.getLogger(TrainingLoadDispatcher.class);

    private final TrainingLoadService service;
    private final ThreadPoolTaskExecutor executor;
    private final AtomicInteger pending = new AtomicInteger();

    public TrainingLoadDispatcher(TrainingLoadService service) {
        this.service = service;
        this.executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(THREADS);
        executor.setMaxPoolSize(THREADS);
        executor.setQueueCapacity(QUEUE_CAPACITY);
        executor.setThreadNamePrefix("training-load-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(SHUTDOWN_WAIT_SECONDS);
        executor.initialize();
    }

    /** 세션 부하 저장을 대기열에 넣는다. 호출 스레드에서 DB를 쓰지 않는다. */
    public void dispatch(long sessionId) {
        pending.incrementAndGet();
        try {
            executor.execute(
                    () -> {
                        try {
                            service.recordSession(sessionId);
                        } catch (RuntimeException e) {
                            // 예외 메시지에는 바인딩한 건강 값이 들어갈 수 있어 종류만 남긴다.
                            log.warn(
                                    "러닝 부하 저장 실패 (sessionId={}, {})",
                                    sessionId,
                                    e.getClass().getSimpleName());
                        } finally {
                            pending.decrementAndGet();
                        }
                    });
        } catch (TaskRejectedException e) {
            pending.decrementAndGet();
            log.warn("러닝 부하 저장을 받지 못해 건너뜀(대기열 초과 또는 종료 중) (sessionId={})", sessionId);
        }
    }

    /** 대기열과 실행 중인 작업이 모두 끝날 때까지 기다린다. 테스트와 운영 점검용. */
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
