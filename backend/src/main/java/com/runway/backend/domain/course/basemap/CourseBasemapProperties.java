package com.runway.backend.domain.course.basemap;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 코스 썸네일(서버가 그린 평면 PNG) 설정(S15P31E105-612). Route 주소는 C01과 같은 {@code runway.course.route.base-url}을 쓰며, 비어
 * 있으면 기동은 하고 생성·일괄 채우기를 하지 않는다.
 */
@ConfigurationProperties(prefix = "runway.course-basemap")
public class CourseBasemapProperties {

    private Duration connectTimeout = Duration.ofSeconds(1);

    /** 연결을 포함한 Route 호출 한 번의 전체 wall-clock 상한. 건물까지 담은 전체 상세(detail "full") 응답을 받는 시간이다. */
    private Duration requestTimeout = Duration.ofSeconds(15);

    /** 응답 본문 상한(바이트). 넘으면 읽기를 멈추고 실패로 본다. Route 계약상 응답은 8MB 미만이다. */
    private int maxResponseBytes = 8 * 1024 * 1024;

    /** 서버 기동 후 바탕 지도가 없는 ACTIVE 코스를 한 번 채울지. */
    private boolean backfillOnStartup = true;

    /** 기동 한 번에 채우기 대상으로 넣는 코스 수 상한. */
    private int backfillLimit = 500;

    /** 일괄 채우기 작업 사이에 쉬는 시간(앞 작업이 끝난 뒤). Route CPU를 추천과 나눠 쓰도록 둔다(B-1). 0 이상. */
    private Duration backfillInterval = Duration.ofSeconds(2);

    /**
     * 일괄 채우기에서 Route가 잠깐 바쁘거나 멈춰 실패한 코스를 처음 시도가 모두 끝난 뒤 한 번 더 시도하기 전에 기다리는 시간(B-6). 0 이상.
     */
    private Duration backfillRetryDelay = Duration.ofMinutes(1);

    /** 일괄 채우기 전에 Route 준비 상태({@code GET /internal/v1/ready})를 다시 확인하는 간격. 양수여야 한다. */
    private Duration readyPollInterval = Duration.ofSeconds(10);

    /** 일괄 채우기 전 Route 준비를 기다리는 최대 시간. 넘으면 이번 기동은 건너뛰고 다음 기동 때 다시 시도한다. */
    private Duration readyWaitTimeout = Duration.ofMinutes(10);

    public Duration getConnectTimeout() {
        return connectTimeout;
    }

    public void setConnectTimeout(Duration connectTimeout) {
        this.connectTimeout = connectTimeout;
    }

    public Duration getRequestTimeout() {
        return requestTimeout;
    }

    public void setRequestTimeout(Duration requestTimeout) {
        this.requestTimeout = requestTimeout;
    }

    public int getMaxResponseBytes() {
        return maxResponseBytes;
    }

    public void setMaxResponseBytes(int maxResponseBytes) {
        this.maxResponseBytes = maxResponseBytes;
    }

    public boolean isBackfillOnStartup() {
        return backfillOnStartup;
    }

    public void setBackfillOnStartup(boolean backfillOnStartup) {
        this.backfillOnStartup = backfillOnStartup;
    }

    public int getBackfillLimit() {
        return backfillLimit;
    }

    public void setBackfillLimit(int backfillLimit) {
        this.backfillLimit = backfillLimit;
    }

    public Duration getBackfillInterval() {
        return backfillInterval;
    }

    public void setBackfillInterval(Duration backfillInterval) {
        this.backfillInterval = backfillInterval;
    }

    public Duration getBackfillRetryDelay() {
        return backfillRetryDelay;
    }

    public void setBackfillRetryDelay(Duration backfillRetryDelay) {
        this.backfillRetryDelay = backfillRetryDelay;
    }

    public Duration getReadyPollInterval() {
        return readyPollInterval;
    }

    public void setReadyPollInterval(Duration readyPollInterval) {
        this.readyPollInterval = readyPollInterval;
    }

    public Duration getReadyWaitTimeout() {
        return readyWaitTimeout;
    }

    public void setReadyWaitTimeout(Duration readyWaitTimeout) {
        this.readyWaitTimeout = readyWaitTimeout;
    }
}
