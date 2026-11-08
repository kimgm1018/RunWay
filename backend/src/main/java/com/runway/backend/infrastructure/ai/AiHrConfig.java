package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.user.personalization.HrPersonalizePort;
import java.net.URI;
import java.net.http.HttpClient;
import java.util.Locale;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI06 호출 구성. 주소가 비어 있어도 기동하며 호출은 실패 결과가 된다(Route 어댑터와 같은 방식). 잘못된 주소는 운영 설정 실수이므로 기동을 실패시킨다.
 */
@Slf4j
@Configuration
@EnableConfigurationProperties(AiHrProperties.class)
public class AiHrConfig {

    @Bean
    HttpClient aiHrHttpClient(AiHrProperties properties) {
        return HttpClient.newBuilder()
                .connectTimeout(properties.getConnectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .version(HttpClient.Version.HTTP_1_1)
                .build();
    }

    @Bean
    HrPersonalizePort aiHrPersonalizeClient(
            HttpClient aiHrHttpClient, AiHrProperties properties, JsonMapper jsonMapper) {
        URI baseUri = parseBaseUrl(properties.getBaseUrl());
        if (baseUri == null) {
            log.warn("AI06 HR 개인화: 주소가 설정되지 않아 호출은 UNAVAILABLE로 실패한다.");
        }
        return new AiHrPersonalizeClient(
                aiHrHttpClient,
                baseUri,
                properties.getRequestTimeout(),
                properties.getMaxRetries(),
                properties.getMaxRetryAfter(),
                jsonMapper);
    }

    /** 빈 값은 미설정(null). 잘못된 값은 기동을 실패시킨다. */
    static URI parseBaseUrl(String raw) {
        if (raw == null || raw.isBlank()) return null;
        URI uri;
        try {
            uri = URI.create(raw.trim());
        } catch (IllegalArgumentException ex) {
            throw invalidBaseUrl();
        }
        String scheme = uri.getScheme();
        String path = uri.getRawPath();
        boolean pathOk = path == null || path.isEmpty() || "/".equals(path);
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
                "runway.ai.hr.base-url은 경로·쿼리·사용자 정보 없는 http(s) origin이어야 합니다.");
    }
}
