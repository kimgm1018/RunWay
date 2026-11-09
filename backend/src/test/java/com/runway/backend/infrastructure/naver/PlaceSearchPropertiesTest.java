package com.runway.backend.infrastructure.naver;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.place.search.PlaceSearchPort;
import com.runway.backend.global.exception.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.json.JsonMapper;

class PlaceSearchPropertiesTest {
    @Configuration
    @Import(PlaceSearchConfig.class)
    static class TestConfig {
        @Bean JsonMapper jsonMapper() { return JsonMapper.builder().build(); }
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(TestConfig.class);

    @Test
    void disabledConfigurationStartsButSearchIsUnavailable() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThatThrownBy(() -> context.getBean(PlaceSearchPort.class).search("공원", null))
                    .isInstanceOf(ApiException.class).hasMessage("일시적으로 처리할 수 없습니다.");
        });
    }

    @Test
    void enabledWithoutSecretFailsWithVariableNameOnly() {
        runner.withPropertyValues("runway.places.enabled=true").run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure()).hasRootCauseMessage(
                    "BACKEND_NAVER_SEARCH_CLIENT_ID 설정이 필요합니다.");
        });
    }

    @Test
    void enabledWithSyntheticCredentialsStarts() {
        runner.withPropertyValues("runway.places.enabled=true",
                "runway.places.search-client-id=synthetic-id",
                "runway.places.search-client-secret=synthetic-secret",
                "runway.places.maps-key-id=synthetic-map-id",
                "runway.places.maps-key=synthetic-map-secret").run(context ->
                        assertThat(context).hasNotFailed());
    }

    @Test
    void malformedSecretErrorNeverContainsItsValue() {
        var properties = new PlaceSearchProperties();
        properties.setEnabled(true);
        properties.setSearchClientId("synthetic-id");
        properties.setSearchClientSecret("synthetic\nsecret");
        assertThatThrownBy(properties::validate)
                .hasMessage("BACKEND_NAVER_SEARCH_CLIENT_SECRET 설정이 필요합니다.")
                .hasNoCause();
    }
}
