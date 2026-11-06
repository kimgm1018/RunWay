package com.runway.backend.domain.session.difficulty;

import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * 코스 구간 난이도 비율 계산 전용 실행기(S15P31E105-297). 코스 저장 요청 스레드가 커밋 직후 작업을 넘기고 바로 응답하도록 별도 스레드에서 {@link
 * CourseDifficultyRunService}를 실행한다.
 *
 * <p>같은 코스가 이미 대기·실행 중이면 새 작업을 만들지 않는다(결과가 코스마다 한 번 저장되면 끝이므로 다시 돌릴 필요가 없다). 대기열이 가득 차거나 종료
 * 중이면 버린다(재전달 없음). 버린 코스는 같은 경로를 다시 저장할 때 다시 시도된다. 재기동하면 대기 작업은 사라진다(허용).
 */
@Component
public class CourseDifficultyDispatcher implements DisposableBean {

    /** AI05 계획 대기열의 기본 동시 실행 수(HEAVY_MAX_CONCURRENCY=1)에 맞춘다. 더 늘리면 백엔드 스스로 AI_BUSY를 만든다. */
    static final int THREADS = 1;
    static final int QUEUE_CAPACITY = 200;
    static final int SHUTDOWN_WAIT_SECONDS = 10;
    static final int KEEP_ALIVE_SECONDS = 60;

    private static final Logger log = LoggerFactory.getLogger(CourseDifficultyDispatcher.class);

    private final CourseDifficultyRunService runService;
    private final ThreadPoolTaskExecutor executor;

    /** 대기·실행 중인 코스. */
    private final Set<Long> inFlight = ConcurrentHashMap.newKeySet();

    /** 넣었지만 아직 끝나지 않은 작업 수. */
    private final AtomicInteger pending = new AtomicInteger();

    public CourseDifficultyDispatcher(CourseDifficultyRunService runService) {
        this.runService = runService;
        this.executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(THREADS);
        executor.setMaxPoolSize(THREADS);
        executor.setQueueCapacity(QUEUE_CAPACITY);
        executor.setKeepAliveSeconds(KEEP_ALIVE_SECONDS);
        executor.setAllowCoreThreadTimeOut(true);
        executor.setThreadNamePrefix("course-difficulty-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(SHUTDOWN_WAIT_SECONDS);
        executor.initialize();
    }

    /** 작업을 대기열에 넣는다. 호출 스레드에서 DB·HTTP를 하지 않는다. */
    public void dispatch(long courseId) {
        if (!inFlight.add(courseId)) {
            log.debug("구간 난이도 비율 계산이 이미 대기·실행 중이라 건너뜀 (courseId={})", courseId);
            return;
        }
        pending.incrementAndGet();
        try {
            executor.execute(() -> run(courseId));
        } catch (TaskRejectedException e) {
            inFlight.remove(courseId);
            pending.decrementAndGet();
            log.warn("구간 난이도 비율 대기열 초과 또는 종료 중이라 건너뜀 (courseId={})", courseId);
        }
    }

    private void run(long courseId) {
        try {
            runService.run(courseId);
        } catch (RuntimeException e) {
            // DB 예외 메시지에 값이 들어 있을 수 있어 클래스 이름만 남긴다.
            log.error(
                    "구간 난이도 비율 계산 오류 (courseId={}, {})",
                    courseId,
                    e.getClass().getSimpleName());
        } finally {
            inFlight.remove(courseId);
            pending.decrementAndGet();
        }
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
}
