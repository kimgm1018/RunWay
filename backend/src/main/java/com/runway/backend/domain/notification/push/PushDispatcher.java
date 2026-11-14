package com.runway.backend.domain.notification.push;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * 푸시 발송 전용 실행기. 요청 스레드는 커밋 직후 알림 ID만 넘기고 바로 응답하며 FCM 호출은 여기서 한다.
 * {@code ReadinessEvaluationDispatcher}처럼 실행기를 이 클래스가 직접 만들고 닫는다({@code Executor} Bean으로 등록하면 Spring Boot
 * 기본 실행기 자동 구성이 꺼진다).
 *
 * <p>스레드 {@value #THREADS}개, 대기열 {@value #QUEUE_CAPACITY}건. 대기열이 차면 그 푸시를 건너뛰고 행은 PENDING으로 남는다(알림함 행은 이미
 * 저장됨). 재시도 큐는 이번 범위가 아니다.
 */
@Component
public class PushDispatcher implements DisposableBean {
    static final int THREADS = 2;
    static final int QUEUE_CAPACITY = 1000;
    static final int SHUTDOWN_WAIT_SECONDS = 10;

    private static final Logger log = LoggerFactory.getLogger(PushDispatcher.class);

    private final PushDispatchService service;
    private final ThreadPoolTaskExecutor executor;

    /** 넣었지만 아직 끝나지 않은 발송 작업 수. */
    private final AtomicInteger pending = new AtomicInteger();

    public PushDispatcher(PushDispatchService service) {
        this.service = service;
        this.executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(THREADS);
        executor.setMaxPoolSize(THREADS);
        executor.setQueueCapacity(QUEUE_CAPACITY);
        executor.setThreadNamePrefix("push-dispatch-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(SHUTDOWN_WAIT_SECONDS);
        executor.initialize();
    }

    public void dispatch(long notificationId) {
        pending.incrementAndGet();
        try {
            executor.execute(
                    () -> {
                        try {
                            service.deliver(notificationId);
                        } catch (RuntimeException e) {
                            // 예외 메시지에는 토큰·SQL 바인딩 값이 들어갈 수 있어 종류만 남긴다.
                            log.warn(
                                    "푸시 발송 처리 실패 (notificationId={}, {})",
                                    notificationId,
                                    e.getClass().getSimpleName());
                        } finally {
                            pending.decrementAndGet();
                        }
                    });
        } catch (TaskRejectedException e) {
            pending.decrementAndGet();
            log.warn("푸시 발송을 받지 못해 건너뜀(대기열 초과 또는 종료 중) (notificationId={})", notificationId);
        }
    }

    /**
     * 대기열과 실행 중인 발송이 모두 끝날 때까지 기다린다. 테스트와 운영 점검에서 쓴다.
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
