package com.runway.backend.infrastructure.ai;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI06 심박 개인화 호출 설정. 주소가 비어 있으면 기동은 하고 호출만 실패한다(저장 없음). 시간 상한은 ODE 적합이 수십 초 걸릴 수 있어 Route보다 길다.
 */
@ConfigurationProperties(prefix = "runway.ai.hr")
public class AiHrProperties {

    /** AI 서비스 내부 origin(예: {@code http://ai:8000}). 경로·쿼리·사용자 정보는 넣지 않는다. */
    private String baseUrl = "";

    private Duration connectTimeout = Duration.ofSeconds(1);

    /** 한 번의 호출(연결 포함)의 전체 wall-clock 상한. 재시도마다 새로 적용한다. */
    private Duration requestTimeout = Duration.ofSeconds(60);

    /** {@code 503 AI_BUSY}일 때만 다시 시도하는 최대 횟수(첫 시도 제외). */
    private int maxRetries = 3;

    /** {@code Retry-After}를 따르되 이 값을 넘으면 이 값만 기다린다. */
    private Duration maxRetryAfter = Duration.ofSeconds(30);

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

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

    public int getMaxRetries() {
        return maxRetries;
    }

    public void setMaxRetries(int maxRetries) {
        this.maxRetries = maxRetries;
    }

    public Duration getMaxRetryAfter() {
        return maxRetryAfter;
    }

    public void setMaxRetryAfter(Duration maxRetryAfter) {
        this.maxRetryAfter = maxRetryAfter;
    }
}
