package com.runway.backend.infrastructure.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * HR 추론 AI 서버(AI01~09) 호출 설정. 주소가 비어 있으면 기동은 하고 실시간 코칭을 판단하지 않는다(더미로 대체하지 않는다). 시간 상한은
 * ai-service.md N7-5(AI04 3초)다.
 */
@ConfigurationProperties(prefix = "runway.coaching.ai")
public class AiServiceProperties {

    /** AI 서버 내부 origin(예: {@code http://ai:8000}). 경로·쿼리·사용자 정보는 넣지 않는다. */
    private String baseUrl = "";

    private Duration connectTimeout = Duration.ofSeconds(1);

    /** 연결을 포함한 AI04 호출 전체 상한. */
    private Duration requestTimeout = Duration.ofSeconds(3);

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
