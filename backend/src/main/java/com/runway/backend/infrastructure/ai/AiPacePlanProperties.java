package com.runway.backend.infrastructure.ai;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI05 출발 전 페이스 계획 호출 설정(코스 구간 난이도 비율 사전 계산, S15P31E105-297). 주소가 비어 있으면 기동은 하고 호출만 하지 않는다(저장 없음).
 */
@ConfigurationProperties(prefix = "runway.ai.pace-plan")
public class AiPacePlanProperties {

    /** AI 서비스 내부 origin(예: {@code http://ai:8000}). 경로·쿼리·사용자 정보는 넣지 않는다. */
    private String baseUrl = "";

    private Duration connectTimeout = Duration.ofSeconds(1);

    /** 한 번의 호출(연결 포함)의 전체 wall-clock 상한. AI05 계획 대기열 대기(기본 30초)보다 길게 두어 AI의 503 응답을 받는다. */
    private Duration requestTimeout = Duration.ofSeconds(45);

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
}
