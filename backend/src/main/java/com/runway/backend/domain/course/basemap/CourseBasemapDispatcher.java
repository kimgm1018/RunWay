package com.runway.backend.domain.course.basemap;

import com.runway.backend.domain.course.basemap.CourseBasemapRunService.Outcome;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 코스 썸네일 바탕 지도 생성 전용 실행기(S15P31E105-612). 코스 저장 요청 스레드와 기동 시 일괄 채우기가 작업을 넘기고 바로 돌아가도록 별도
 * 스레드 하나에서 {@link CourseBasemapRunService}를 실행한다(Route 추천 계산과 경쟁하지 않도록 한 번에 하나).
 *
 * <p>대기열은 둘이다(A-5). 코스 저장 이벤트({@link #dispatch})는 항상 남은 일괄 채우기({@link #dispatchBackfill})보다 먼저
 * 실행한다. 일괄 채우기 작업은 앞 작업이 끝난 뒤 {@code backfill-interval}만큼 쉬고 시작한다(B-1 완화). 저장 이벤트는 쉬지 않는다.
 *
 * <p>일괄 채우기에서 Route가 잠깐 바쁘거나 멈춘 실패({@link Outcome#FAILED_RETRYABLE})로 끝난 코스는 일괄 채우기 대기열이 빈 뒤
 * {@code backfill-retry-delay}만큼 기다렸다가 같은 실행 안에서 한 번만 다시 시도한다(B-6). 다시 실패하면 다음 기동 때 시도한다.
 *
 * <p>같은 코스가 이미 대기·실행 중이면 새 작업을 만들지 않는다. 단 일괄 채우기로 대기 중인 코스에 저장 이벤트가 오면 저장 대기열로 앞당긴다.
 * 대기열이 가득 차거나 종료 중이면 버린다(재전달 없음). 버린 코스는 다음 기동 때 일괄 채우기가 다시 넣는다. 재기동하면 대기 작업은 사라진다(허용).
 *
 * <p>S15P31E105-756: 러닝 기록 경로 썸네일({@link RunRouteBasemapRunService})도 같은 스레드·대기열·규칙으로 실행한다(Route 바탕 지도
 * 호출을 한 번에 하나로 유지). 작업은 종류(코스/기록)와 ID로 구분한다.
 */
@Component
public class CourseBasemapDispatcher implements DisposableBean {

    /** 저장 이벤트 대기열 크기. */
    static final int EVENT_QUEUE_CAPACITY = 200;

    static final int SHUTDOWN_WAIT_SECONDS = 10;

    static final String THREAD_NAME = "course-basemap-1";

    private static final Logger log = LoggerFactory.getLogger(CourseBasemapDispatcher.class);

    private final CourseBasemapRunService runService;
    private final int backfillCapacity;
    private final long backfillIntervalNanos;
    private final long retryDelayNanos;

    private final ReentrantLock lock = new ReentrantLock();
    private final Condition changed = lock.newCondition();

    /** 대기·실행 단위. {@code run}이면 러닝 기록(세션) ID, 아니면 코스 ID. */
    record Job(boolean run, long id) {

        static Job course(long courseId) {
            return new Job(false, courseId);
        }

        static Job session(long sessionId) {
            return new Job(true, sessionId);
        }

        @Override
        public String toString() {
            return (run ? "sessionId=" : "courseId=") + id;
        }
    }

    private final RunRouteBasemapRunService runRouteService;

    /** 저장 이벤트로 대기 중인 작업(넣은 순서). */
    private final LinkedHashSet<Job> saves = new LinkedHashSet<>();

    /** 일괄 채우기로 대기 중인 작업(넣은 순서) → 다시 시도 여부. */
    private final Map<Job, Boolean> backfill = new java.util.LinkedHashMap<>();

    /** 일괄 채우기에서 다시 시도할 수 있게 실패해 대기열이 빈 뒤 한 번 더 넣을 작업. */
    private final LinkedHashSet<Job> retries = new LinkedHashSet<>();

    /** 실행 중인 작업. 없으면 null. */
    private Job running;

    /** 이 시각(nanoTime) 전에는 일괄 채우기 작업을 시작하지 않는다. */
    private long backfillNotBefore;

    private boolean stopped;

    private final Thread worker;

    /** 코스 썸네일만 실행한다(기록 작업은 넣어도 실행하지 않고 실패로 끝난다). 테스트용. */
    public CourseBasemapDispatcher(
            CourseBasemapRunService runService, CourseBasemapProperties properties) {
        this(runService, null, properties);
    }

    @Autowired
    public CourseBasemapDispatcher(
            CourseBasemapRunService runService,
            RunRouteBasemapRunService runRouteService,
            CourseBasemapProperties properties) {
        this.runService = runService;
        this.runRouteService = runRouteService;
        this.backfillCapacity =
                Math.max(0, properties.getBackfillLimit())
                        + Math.max(0, properties.getRunBackfillLimit());
        this.backfillIntervalNanos = nonNegativeNanos(properties.getBackfillInterval());
        this.retryDelayNanos = nonNegativeNanos(properties.getBackfillRetryDelay());
        this.backfillNotBefore = System.nanoTime();
        this.worker = new Thread(this::work, THREAD_NAME);
        worker.setDaemon(true);
        worker.start();
    }

    private static long nonNegativeNanos(Duration duration) {
        return duration == null || duration.isNegative() ? 0 : duration.toNanos();
    }

    /**
     * 코스 저장 이벤트 작업을 넣는다. 남은 일괄 채우기보다 먼저 실행한다. 호출 스레드에서 DB·HTTP를 하지 않는다.
     *
     * @return 새로 넣었거나 일괄 채우기 대기에서 앞당겼으면 true(이미 대기·실행 중이거나 대기열이 가득 차거나 종료 중이면 false)
     */
    public boolean dispatch(long courseId) {
        return dispatch(Job.course(courseId));
    }

    /** 러닝 기록 종료 이벤트 작업을 넣는다(S15P31E105-756). 규칙은 {@link #dispatch(long)}와 같다. */
    public boolean dispatchRun(long sessionId) {
        return dispatch(Job.session(sessionId));
    }

    private boolean dispatch(Job job) {
        lock.lock();
        try {
            if (stopped) {
                log.warn("바탕 지도 실행기가 종료 중이라 건너뜀 ({})", job);
                return false;
            }
            if (job.equals(running) || saves.contains(job)) {
                log.debug("바탕 지도 생성이 이미 대기·실행 중이라 건너뜀 ({})", job);
                return false;
            }
            boolean promoted = backfill.remove(job) != null | retries.remove(job);
            if (!promoted && saves.size() >= EVENT_QUEUE_CAPACITY) {
                log.warn("바탕 지도 대기열 초과라 건너뜀 ({})", job);
                return false;
            }
            saves.add(job);
            changed.signalAll();
            return true;
        } finally {
            lock.unlock();
        }
    }

    /**
     * 일괄 채우기 작업을 넣는다. 저장 이벤트가 없을 때만, 앞 작업 뒤 {@code backfill-interval}을 쉬고 실행한다.
     *
     * @return 새로 넣었으면 true(이미 대기·실행 중이거나 대기열이 가득 차거나 종료 중이면 false)
     */
    public boolean dispatchBackfill(long courseId) {
        return dispatchBackfill(Job.course(courseId));
    }

    /** 러닝 기록 일괄 채우기 작업을 넣는다(S15P31E105-756). 규칙은 {@link #dispatchBackfill(long)}와 같다. */
    public boolean dispatchRunBackfill(long sessionId) {
        return dispatchBackfill(Job.session(sessionId));
    }

    private boolean dispatchBackfill(Job job) {
        lock.lock();
        try {
            if (stopped) {
                return false;
            }
            if (job.equals(running)
                    || saves.contains(job)
                    || backfill.containsKey(job)
                    || retries.contains(job)) {
                return false;
            }
            if (backfill.size() >= backfillCapacity) {
                log.warn("바탕 지도 일괄 채우기 대기열 초과라 건너뜀 ({})", job);
                return false;
            }
            backfill.put(job, Boolean.FALSE);
            changed.signalAll();
            return true;
        } finally {
            lock.unlock();
        }
    }

    private void work() {
        while (true) {
            Job job;
            boolean fromBackfill;
            boolean retry;
            lock.lock();
            try {
                while (true) {
                    if (stopped) {
                        return;
                    }
                    if (!saves.isEmpty()) {
                        job = saves.removeFirst();
                        fromBackfill = false;
                        retry = false;
                        break;
                    }
                    if (backfill.isEmpty() && !retries.isEmpty()) {
                        // 처음 시도가 모두 끝났다. Route가 회복할 시간을 둔 뒤 실패한 코스를 한 번만 다시 넣는다.
                        log.info("바탕 지도 일괄 채우기 다시 시도 예약 (courses={})", retries.size());
                        for (Job id : retries) {
                            backfill.put(id, Boolean.TRUE);
                        }
                        retries.clear();
                        backfillNotBefore =
                                Math.max(backfillNotBefore - System.nanoTime(), retryDelayNanos)
                                        + System.nanoTime();
                    }
                    if (!backfill.isEmpty()) {
                        long wait = backfillNotBefore - System.nanoTime();
                        if (wait <= 0) {
                            var first = backfill.entrySet().iterator().next();
                            job = first.getKey();
                            retry = first.getValue();
                            backfill.remove(job);
                            fromBackfill = true;
                            break;
                        }
                        changed.awaitNanos(wait);
                        continue;
                    }
                    changed.await();
                }
                running = job;
            } catch (InterruptedException e) {
                return;
            } finally {
                lock.unlock();
            }

            Outcome outcome = run(job);

            lock.lock();
            try {
                running = null;
                if (fromBackfill && !retry && outcome == Outcome.FAILED_RETRYABLE && !stopped) {
                    retries.add(job);
                }
                backfillNotBefore = System.nanoTime() + backfillIntervalNanos;
                changed.signalAll();
            } finally {
                lock.unlock();
            }
        }
    }

    private Outcome run(Job job) {
        try {
            if (job.run()) {
                return runRouteService == null ? Outcome.FAILED : runRouteService.run(job.id());
            }
            return runService.run(job.id());
        } catch (RuntimeException e) {
            // DB 예외 메시지에 값이 들어 있을 수 있어 클래스 이름만 남긴다.
            log.error("바탕 지도 생성 오류 ({}, {})", job, e.getClass().getSimpleName());
            return Outcome.FAILED;
        }
    }

    /**
     * 대기열(다시 시도 예정 포함)과 실행 중인 작업이 모두 끝날 때까지 기다린다. 테스트와 운영 점검에서 완료를 확인할 때 쓴다.
     *
     * @return 제한 시간 안에 비었으면 true
     */
    public boolean awaitIdle(Duration timeout) throws InterruptedException {
        long remaining = timeout.toNanos();
        lock.lock();
        try {
            while (running != null || !saves.isEmpty() || !backfill.isEmpty() || !retries.isEmpty()) {
                if (stopped || remaining <= 0) {
                    return false;
                }
                remaining = changed.awaitNanos(remaining);
            }
            return true;
        } finally {
            lock.unlock();
        }
    }

    @Override
    public void destroy() {
        lock.lock();
        try {
            stopped = true;
            saves.clear();
            backfill.clear();
            retries.clear();
            changed.signalAll();
        } finally {
            lock.unlock();
        }
        // 실행 중인 Route 호출은 인터럽트로 멈춘다(INTERRUPTED 실패, 저장하지 않음).
        worker.interrupt();
        try {
            worker.join(TimeUnit.SECONDS.toMillis(SHUTDOWN_WAIT_SECONDS));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
