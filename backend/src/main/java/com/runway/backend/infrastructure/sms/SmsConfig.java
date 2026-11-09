package com.runway.backend.infrastructure.sms;

import com.runway.backend.domain.auth.verification.SmsPort;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.json.JsonMapper;

@Configuration
@EnableConfigurationProperties(SmsProperties.class)
public class SmsConfig {
    @Bean
    SmsPort smsPort(SmsProperties properties, JsonMapper mapper) {
        properties.validate();
        return new SolapiSmsClient(properties, mapper);
    }
}
