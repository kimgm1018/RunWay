package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.session.difficulty.CourseDifficultyPort;
import java.net.URI;
import java.net.http.HttpClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI05 호출 구성(S15P31E105-297). 주소가 비어 있어도 기동하며 호출은 빈 결과가 된다. 잘못된 주소는 운영 설정 실수이므로 기동을 실패시킨다.
 */
@Slf4j
@Configuration
@EnableConfigurationProperties(AiPacePlanProperties.class)
public class AiPacePlanConfig {

    @Bean
    CourseDifficultyPort aiPacePlanClient(AiPacePlanProperties properties, JsonMapper jsonMapper) {
        URI baseUri;
        try {
            baseUri = AiHrConfig.parseBaseUrl(properties.getBaseUrl());
        } catch (IllegalStateException ex) {
            throw new IllegalStateException(
                    "runway.ai.pace-plan.base-url은 경로·쿼리·사용자 정보 없는 http(s) origin이어야 합니다.");
        }
        if (baseUri == null) {
            log.warn("AI05 구간 난이도 비율: 주소가 설정되지 않아 계산·저장하지 않는다.");
        }
        HttpClient client =
                HttpClient.newBuilder()
                        .connectTimeout(properties.getConnectTimeout())
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .version(HttpClient.Version.HTTP_1_1)
                        .build();
        return new AiPacePlanClient(client, baseUri, properties.getRequestTimeout(), jsonMapper);
    }
}
