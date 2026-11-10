package com.runway.backend.domain.readiness.service;

import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * 준비도 평가 전용 실행기. W06 요청 스레드가 커밋 직후 평가를 넘기고 바로 응답하도록 평가를 별도 스레드에서 실행한다. W06 요청은 자기 커넥션만 쓰고 바로
 * 반납한다.
 *
 * <p>실행기는 이 클래스가 직접 만들고 닫는다. {@code Executor} 타입 Bean으로 등록하면 Spring Boot 기본 실행기(applicationTaskExecutor)
 * 자동 구성이 꺼지므로 Bean으로 노출하지 않는다. 전역 {@code @EnableAsync}도 쓰지 않는다.
 *
 * <p>스레드 {@value #THREADS}개, 대기열 {@value #QUEUE_CAPACITY}건. 대기열이 차면 그 이벤트의 평가를 건너뛰고 회원 ID·날짜를 로그로 남긴다(재전달
 * 없음, 정기 재평가는 후속). 종료 시 대기 중인 평가를 최대 {@value #SHUTDOWN_WAIT_SECONDS}초 기다린다.
 */
@Component
public class ReadinessEvaluationDispatcher implements DisposableBean {

    static final int THREADS = 2;
    static final int QUEUE_CAPACITY = 1000;
    static final int SHUTDOWN_WAIT_SECONDS = 10;

    private static final Logger log = LoggerFactory.getLogger(ReadinessEvaluationDispatcher.class);

    private final ReadinessEvaluationService evaluationService;
    private final ThreadPoolTaskExecutor executor;

    /** 넣었지만 아직 끝나지 않은 평가 작업 수. 실행기 내부 수치는 작업을 꺼낸 직후 잠시 0이 될 수 있어 직접 센다. */
    private final AtomicInteger pending = new AtomicInteger();

    public ReadinessEvaluationDispatcher(ReadinessEvaluationService evaluationService) {
        this.evaluationService = evaluationService;
        this.executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(THREADS);
        executor.setMaxPoolSize(THREADS);
        executor.setQueueCapacity(QUEUE_CAPACITY);
        executor.setThreadNamePrefix("readiness-eval-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(SHUTDOWN_WAIT_SECONDS);
        executor.initialize();
    }

    /** 바뀐 날짜와 그 영향을 받는 이후 날짜의 평가를 대기열에 넣는다. 호출 스레드에서 DB를 쓰지 않는다. */
    public void dispatch(long userId, List<LocalDate> changedDates) {
        dispatch(userId, changedDates, List.of());
    }

    /** loadChangedDates: 그중 일별 부하가 바뀐 날짜(이후 27일까지 재평가, S15P31E105-599). */
    public void dispatch(
            long userId, List<LocalDate> changedDates, List<LocalDate> loadChangedDates) {
        pending.incrementAndGet();
        try {
            executor.execute(
                    () -> {
                        try {
                            run(userId, changedDates, loadChangedDates);
                        } finally {
                            pending.decrementAndGet();
                        }
                    });
        } catch (TaskRejectedException e) {
            pending.decrementAndGet();
            log.warn(
                    "준비도 자동 평가를 받지 못해 건너뜀(대기열 초과 또는 종료 중) (userId={}, dates={})",
                    userId,
                    changedDates);
        }
    }

    /**
     * 날짜마다 별도 트랜잭션으로 평가한다. 한 날짜가 실패해도 나머지는 계속한다. 로그에는 회원 ID·날짜·예외 종류만 남기고 예외 메시지는 남기지 않는다(DB
     * 드라이버 메시지에 바인딩한 건강 값이 들어갈 수 있다).
     */
    private void run(
            long userId, List<LocalDate> changedDates, List<LocalDate> loadChangedDates) {
        List<LocalDate> targets;
        try {
            targets = evaluationService.targetDates(userId, changedDates, loadChangedDates);
        } catch (RuntimeException e) {
            log.warn(
                    "준비도 자동 평가 대상 조회 실패 (userId={}, dates={}, {})",
                    userId,
                    changedDates,
                    e.getClass().getSimpleName());
            return;
        }
        for (LocalDate date : targets) {
            try {
                evaluationService.evaluate(userId, date);
            } catch (RuntimeException e) {
                log.warn(
                        "준비도 자동 평가 실패 (userId={}, date={}, {})",
                        userId,
                        date,
                        e.getClass().getSimpleName());
            }
        }
    }

    /**
     * 대기열과 실행 중인 평가가 모두 끝날 때까지 기다린다. 테스트와 운영 점검에서 평가 완료를 확인할 때 쓴다.
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
