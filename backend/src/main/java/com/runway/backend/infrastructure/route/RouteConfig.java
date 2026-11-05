package com.runway.backend.infrastructure.route;

import com.runway.backend.domain.course.recommend.CourseRecommendPort;
import com.runway.backend.domain.course.recommend.StubCourseRecommendAdapter;

import lombok.extern.slf4j.Slf4j;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.time.Clock;

/**
 * C01 생성기 선택. 기본은 Route HTTP 어댑터이고, 개발자가 {@code runway.course.route.mode=stub}을 명시할 때만 스텁을
 * 주입한다. 실행 중 실패했다고 스텁으로 바꾸지 않는다(courses.md 생성기 교체).
 */
@Slf4j
@Configuration
@EnableConfigurationProperties(RouteProperties.class)
public class RouteConfig {

    @Bean
    CourseRecommendPort courseRecommendPort(
            RouteProperties properties, JsonMapper jsonMapper, Clock clock) {
        if (properties.isStubMode()) {
            log.warn("코스 생성기: 개발용 스텁 모드. 실제 추천이 아닌 가짜 경로를 반환한다.");
            return new StubCourseRecommendAdapter();
        }
        URI baseUri = parseBaseUrl(properties.getBaseUrl());
        if (baseUri == null) {
            log.warn("코스 생성기: Route 주소가 설정되지 않아 C01은 ROUTE_UNAVAILABLE로 응답한다.");
        }
        return new RouteHttpCourseRecommendAdapter(
                baseUri,
                properties.getConnectTimeout(),
                properties.getRequestTimeout(),
                jsonMapper,
                clock);
    }

    /** 빈 값은 미설정(null). 잘못된 값은 운영 설정 실수이므로 기동을 실패시킨다. */
    static URI parseBaseUrl(String raw) {
        if (raw == null || raw.isBlank()) return null;
        URI uri;
        try {
            uri = URI.create(raw.trim());
        } catch (IllegalArgumentException ex) {
            throw invalidBaseUrl();
        }
        String scheme = uri.getScheme();
        boolean pathOk = uri.getRawPath() == null || uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath());
        if (scheme == null
                || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                || uri.getHost() == null
                || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null
                || uri.getRawFragment() != null
                || !pathOk) {
            throw invalidBaseUrl();
        }
        return URI.create(scheme.toLowerCase(java.util.Locale.ROOT) + "://" + uri.getRawAuthority());
    }

    private static IllegalStateException invalidBaseUrl() {
        return new IllegalStateException(
                "runway.course.route.base-url은 경로·쿼리·사용자 정보 없는 http(s) origin이어야 합니다.");
    }
}
