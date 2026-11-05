package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.coaching.decide.PaceDecider;

import lombok.extern.slf4j.Slf4j;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.util.Locale;
import java.util.Optional;

/** AI04 판단기 선택. 주소가 없으면 판단하지 않는 구현을 주입한다. 실행 중 실패했다고 다른 구현으로 바꾸지 않는다. */
@Slf4j
@Configuration
@EnableConfigurationProperties(AiServiceProperties.class)
public class AiServiceConfig {

    @Bean
    PaceDecider paceDecider(AiServiceProperties properties, JsonMapper jsonMapper) {
        URI baseUri = parseBaseUrl(properties.getBaseUrl());
        if (baseUri == null) {
            log.warn("실시간 코칭: AI 서버 주소가 설정되지 않아 AI04 판단과 자동 코칭을 하지 않는다.");
            return request -> Optional.empty();
        }
        return new AiPaceDecideHttpClient(
                baseUri,
                properties.getConnectTimeout(),
                properties.getRequestTimeout(),
                jsonMapper);
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
        boolean pathOk =
                uri.getRawPath() == null || uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath());
        if (scheme == null
                || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                || uri.getHost() == null
                || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null
                || uri.getRawFragment() != null
                || !pathOk) {
            throw invalidBaseUrl();
        }
        return URI.create(scheme.toLowerCase(Locale.ROOT) + "://" + uri.getRawAuthority());
    }

    private static IllegalStateException invalidBaseUrl() {
        return new IllegalStateException(
                "runway.coaching.ai.base-url은 경로·쿼리·사용자 정보 없는 http(s) origin이어야 합니다.");
    }
}
