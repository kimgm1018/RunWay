package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.session.service.PersonalPacePlanPort;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.databind.json.JsonMapper;

import java.net.http.HttpClient;
import java.time.Duration;

@Configuration
public class AiPersonalPacePlanConfig {
    // AI09 한 번의 계획 준비 전체 상한(재시도 포함, S15P31E105-533). 폰 S01 요청 상한(50초)보다 짧게 두어
    // 폰이 포기한 뒤에 끝나는 계획 계산이 남지 않게 한다. AI 대기열 대기(HEAVY_QUEUE_WAIT_SEC 기본 30초)보다 길다.
    static final Duration TOTAL_TIMEOUT = Duration.ofSeconds(40);

    @Bean
    PersonalPacePlanPort personalPacePlanPort(AiPacePlanProperties properties, JsonMapper mapper) {
        return new AiPersonalPacePlanClient(
                HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(1))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build(),
                AiHrConfig.parseBaseUrl(properties.getBaseUrl()),
                TOTAL_TIMEOUT,
                mapper);
    }
}
