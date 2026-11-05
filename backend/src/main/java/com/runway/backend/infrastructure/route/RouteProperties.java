package com.runway.backend.infrastructure.route;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * C01 코스 생성기 설정. 기본은 Route HTTP이며 스텁은 개발자가 {@code mode=stub}을 명시할 때만 쓴다. 주소가 비어 있으면
 * 기동은 하고 C01이 {@code ROUTE_UNAVAILABLE}로 실패한다. 시간 상한은 ai-service.md Route 계약 초안(연결 1초, 전체 15초)이다.
 */
@ConfigurationProperties(prefix = "runway.course.route")
public class RouteProperties {

    /** {@code http}(기본) 또는 {@code stub}. */
    private String mode = "http";

    /** Route 전용 내부 origin(예: {@code http://route:8000}). 경로·쿼리·사용자 정보는 넣지 않는다. */
    private String baseUrl = "";

    private Duration connectTimeout = Duration.ofSeconds(1);

    /** 연결을 포함한 Route 호출 전체 wall-clock 상한. */
    private Duration requestTimeout = Duration.ofSeconds(15);

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

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

    /** 공백·대소문자를 무시한 stub 여부. 알 수 없는 값은 기동 실패로 드러낸다. */
    public boolean isStubMode() {
        String normalized = mode == null ? "" : mode.trim().toLowerCase(java.util.Locale.ROOT);
        return switch (normalized) {
            case "", "http" -> false;
            case "stub" -> true;
            default ->
                    throw new IllegalStateException(
                            "runway.course.route.mode는 http 또는 stub이어야 합니다.");
        };
    }
}
