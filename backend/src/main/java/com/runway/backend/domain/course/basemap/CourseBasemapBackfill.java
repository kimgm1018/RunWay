package com.runway.backend.domain.course.basemap;

import java.util.List;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 기동 후 현재 그리기 버전({@link CourseBasemapRunService#RENDER_VERSION})의 썸네일이 없는 ACTIVE 코스(행이 없거나 이전 버전)를
 * 한 번 채운다(S15P31E105-612 D-2). 한 번에 최대 {@code backfill-limit}개를 같은 실행기의 일괄 채우기 대기열에 넣는다(실행기는
 * 작업 사이에 {@code backfill-interval}을 쉬고, 저장 이벤트를 먼저 처리하며, Route가 잠깐 멈춘 실패는 같은 실행 안에서 한 번 더
 * 시도한다). 채워진 코스는 다음 기동부터
 * 조회되지 않으므로 사실상 배포(또는 그리기 버전 변경) 때 한 번 하는 작업이다.
 *
 * <p>Route가 엔진 로드·예열 중이면 바탕 지도 요청도 실패해 이번 기동의 채우기가 헛돌므로, 넣기 전에 Route 준비 상태({@code GET
 * /internal/v1/ready})를 {@code ready-poll-interval}마다 확인하며 최대 {@code ready-wait-timeout}까지 기다린다. 기다림은
 * 전용 데몬 스레드에서 하므로 기동과 {@link ApplicationReadyEvent} 처리 스레드를 막지 않고, 바탕 지도 실행기(스레드 1개)도 점유하지
 * 않는다. 제한 시간 안에 준비되지 않으면 로그만 남기고 건너뛴다(다음 기동 때 다시 시도).
 *
 * <p>조회 실패는 기동을 막지 않도록 로그만 남긴다.
 */
@Component
@RequiredArgsConstructor
public class CourseBasemapBackfill implements DisposableBean {

    static final String THREAD_NAME = "course-basemap-backfill";

    private static final Logger log = LoggerFactory.getLogger(CourseBasemapBackfill.class);

    private final CourseBasemapRepository repository;
    private final CourseBasemapDispatcher dispatcher;
    private final CourseBasemapPort port;
    private final CourseBasemapProperties properties;

    /** 준비 대기·넣기 스레드. 종료 시 깨워 멈춘다. */
    private volatile Thread worker;

    /** 종료가 시작되면 true. 그 뒤에는 새 대기 스레드를 만들지 않는다. */
    private boolean stopped;

    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        try {
            start();
        } catch (RuntimeException e) {
            log.error("바탕 지도 일괄 채우기 시작 실패 ({})", e.getClass().getSimpleName());
        }
    }

    /**
     * 설정이 켜져 있으면 Route 준비를 기다린 뒤 대상을 넣는 데몬 스레드를 시작하고 바로 돌아온다.
     *
     * @return 시작한 스레드. 설정이 꺼져 있거나 주소가 없거나 상한이 0 이하이면 null
     */
    synchronized Thread start() {
        if (stopped || !enabled()) {
            return null;
        }
        if (worker != null) {
            // 기동 완료 이벤트가 두 번 와도(하위 context 등) 대기 스레드는 하나만 둔다.
            return worker;
        }
        Thread thread = new Thread(this::awaitReadyAndSubmit, THREAD_NAME);
        thread.setDaemon(true);
        worker = thread;
        thread.start();
        return thread;
    }

    /** Route 준비를 기다린 뒤 대상을 넣는다. 준비되지 않으면 건너뛴다. 예외를 밖으로 던지지 않는다. */
    void awaitReadyAndSubmit() {
        try {
            if (!awaitRouteReady()) {
                log.warn(
                        "바탕 지도 일괄 채우기 생략: Route가 {} 안에 준비되지 않음(다음 기동 때 다시 시도)",
                        properties.getReadyWaitTimeout());
                return;
            }
            submit();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.info("바탕 지도 일괄 채우기 중단: 종료 중");
        } catch (RuntimeException e) {
            log.error("바탕 지도 일괄 채우기 대상 조회 실패 ({})", e.getClass().getSimpleName());
        }
    }

    /**
     * Route가 준비될 때까지 확인 간격마다 다시 묻는다. 마지막 확인은 제한 시간 시점에 한다.
     *
     * @return 제한 시간 안에 준비되면 true
     */
    boolean awaitRouteReady() throws InterruptedException {
        long intervalNanos = properties.getReadyPollInterval().toNanos();
        long deadline = System.nanoTime() + properties.getReadyWaitTimeout().toNanos();
        while (true) {
            if (port.isReady()) {
                return true;
            }
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) {
                return false;
            }
            TimeUnit.NANOSECONDS.sleep(Math.min(intervalNanos, remaining));
        }
    }

    /**
     * 대상 코스를 실행기에 넣는다. Route 준비는 확인하지 않는다.
     *
     * @return 실행기에 새로 넣은 코스 수
     */
    public int submit() {
        if (!enabled()) {
            return 0;
        }
        List<Long> courseIds = repository.findActiveCourseIdsNeedingRender(
                        CourseBasemapRunService.RENDER_VERSION, properties.getBackfillLimit());
        int submitted = 0;
        for (long courseId : courseIds) {
            if (dispatcher.dispatchBackfill(courseId)) {
                submitted++;
            }
        }
        log.info("바탕 지도 일괄 채우기 시작 (targets={}, submitted={})", courseIds.size(), submitted);
        return submitted;
    }

    private boolean enabled() {
        if (!properties.isBackfillOnStartup()) {
            return false;
        }
        if (!port.isConfigured()) {
            log.info("바탕 지도 일괄 채우기 생략: Route 주소가 설정되지 않음");
            return false;
        }
        return properties.getBackfillLimit() > 0;
    }

    @Override
    public synchronized void destroy() {
        stopped = true;
        Thread thread = worker;
        if (thread != null) {
            thread.interrupt();
        }
    }
}
