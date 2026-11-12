package com.runway.backend.domain.runningrecord.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * H08 공유 링크 주소의 공개 origin(S15P31E105-704). {@code BACKEND_SHARE_BASE_URL}로 바꿀 수 있고 기본값은 운영 도메인이다. 링크는
 * {@code {baseUrl}/r/{token}}이다.
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "runway.share")
public class RunShareProperties {

    private static final String DEFAULT_BASE_URL = "https://k15e105.p.ssafy.io";

    private String baseUrl = DEFAULT_BASE_URL;

    /** 끝의 '/'를 뺀 origin. 비어 있으면 기본값을 쓴다. */
    public String normalizedBaseUrl() {
        String value = baseUrl == null || baseUrl.isBlank() ? DEFAULT_BASE_URL : baseUrl.strip();
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }
}
