package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.session.service.PersonalPacePlanPort;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.databind.json.JsonMapper;

import java.net.http.HttpClient;
import java.time.Duration;

@Configuration
public class AiPersonalPacePlanConfig {
    @Bean
    PersonalPacePlanPort personalPacePlanPort(AiPacePlanProperties properties, JsonMapper mapper) {
        return new AiPersonalPacePlanClient(
                HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(1))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build(),
                AiHrConfig.parseBaseUrl(properties.getBaseUrl()),
                Duration.ofSeconds(60),
                mapper);
    }
}
