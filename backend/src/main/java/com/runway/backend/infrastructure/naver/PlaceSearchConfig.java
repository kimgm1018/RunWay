package com.runway.backend.infrastructure.naver;

import com.runway.backend.domain.place.search.PlaceSearchPort;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.json.JsonMapper;

@Configuration
@EnableConfigurationProperties(PlaceSearchProperties.class)
public class PlaceSearchConfig {
    @Bean
    PlaceSearchPort placeSearchPort(PlaceSearchProperties properties, JsonMapper mapper) {
        properties.validate();
        return new NaverPlaceSearchClient(properties, mapper);
    }
}
