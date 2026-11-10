package com.runway.backend.infrastructure.route;

import com.runway.backend.domain.course.basemap.CourseBasemapPort;
import com.runway.backend.domain.course.basemap.CourseBasemapProperties;

import lombok.extern.slf4j.Slf4j;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.databind.json.JsonMapper;

import java.net.URI;

/**
 * 코스 썸네일 바탕 지도 Route 호출 구성(S15P31E105-612). 주소는 C01과 같은 {@code runway.course.route.base-url}이다. 비어
 * 있으면 기동은 하고 바탕 지도를 만들지 않는다. 잘못된 주소는 {@link RouteConfig}와 같이 기동을 실패시킨다.
 */
@Slf4j
@Configuration
@EnableConfigurationProperties({RouteProperties.class, CourseBasemapProperties.class})
public class CourseBasemapConfig {

    @Bean
    CourseBasemapPort courseBasemapPort(
            RouteProperties routeProperties,
            CourseBasemapProperties properties,
            JsonMapper jsonMapper) {
        URI baseUri = RouteConfig.parseBaseUrl(routeProperties.getBaseUrl());
        if (baseUri == null) {
            log.warn("코스 바탕 지도: Route 주소가 설정되지 않아 생성하지 않는다.");
        }
        if (properties.getMaxResponseBytes() <= 0) {
            throw new IllegalStateException("runway.course-basemap.max-response-bytes는 양수여야 합니다.");
        }
        if (properties.getReadyPollInterval() == null
                || properties.getReadyPollInterval().isNegative()
                || properties.getReadyPollInterval().isZero()) {
            throw new IllegalStateException("runway.course-basemap.ready-poll-interval은 양수여야 합니다.");
        }
        if (properties.getReadyWaitTimeout() == null
                || properties.getReadyWaitTimeout().isNegative()) {
            throw new IllegalStateException(
                    "runway.course-basemap.ready-wait-timeout은 0 이상이어야 합니다.");
        }
        if (properties.getBackfillInterval() == null || properties.getBackfillInterval().isNegative()) {
            throw new IllegalStateException(
                    "runway.course-basemap.backfill-interval은 0 이상이어야 합니다.");
        }
        if (properties.getBackfillRetryDelay() == null
                || properties.getBackfillRetryDelay().isNegative()) {
            throw new IllegalStateException(
                    "runway.course-basemap.backfill-retry-delay는 0 이상이어야 합니다.");
        }
        return new RouteHttpCourseBasemapAdapter(
                baseUri,
                properties.getConnectTimeout(),
                properties.getRequestTimeout(),
                properties.getMaxResponseBytes(),
                jsonMapper);
    }
}
