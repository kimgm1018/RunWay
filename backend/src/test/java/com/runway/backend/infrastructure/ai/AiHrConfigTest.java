package com.runway.backend.infrastructure.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.user.personalization.HrPersonalizePort;
import com.runway.backend.domain.user.personalization.HrPersonalizeResult;
import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import tools.jackson.databind.json.JsonMapper;

class AiHrConfigTest {

    @Configuration
    @Import(AiHrConfig.class)
    static class TestConfig {
        @Bean
        JsonMapper jsonMapper() {
            return JsonMapper.builder().build();
        }
    }

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(TestConfig.class);

    @Test
    void 주소가_없어도_기동하고_호출은_실패_결과가_된다() {
        runner.run(
                context -> {
                    assertThat(context).hasNotFailed();
                    HrPersonalizePort port = context.getBean(HrPersonalizePort.class);
                    assertThat(
                                    port.personalize(
                                            new com.runway.backend.domain.user.personalization
                                                    .Ai06PersonalizeRequest(7L, List.of())))
                            .isEqualTo(
                                    new HrPersonalizeResult.Failure(
                                            HrPersonalizeResult.Reason.UNAVAILABLE, 0));
                });
    }

    @Test
    void 기본값은_계약_설정과_같다() {
        runner.withPropertyValues("runway.ai.hr.base-url=http://ai:8000")
                .run(
                        context -> {
                            AiHrProperties props = context.getBean(AiHrProperties.class);
                            assertThat(props.getConnectTimeout()).hasSeconds(1);
                            assertThat(props.getRequestTimeout()).hasSeconds(60);
                            assertThat(props.getMaxRetries()).isEqualTo(3);
                            assertThat(props.getMaxRetryAfter()).hasSeconds(30);
                        });
    }

    @Test
    void 잘못된_주소는_기동을_실패시킨다() {
        runner.withPropertyValues("runway.ai.hr.base-url=http://ai:8000/v1")
                .run(context -> assertThat(context).hasFailed());
        assertThatThrownBy(() -> AiHrConfig.parseBaseUrl("ftp://ai"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void origin만_받고_정규화한다() {
        assertThat(AiHrConfig.parseBaseUrl("")).isNull();
        assertThat(AiHrConfig.parseBaseUrl("  ")).isNull();
        assertThat(AiHrConfig.parseBaseUrl("HTTP://ai:8000/")).isEqualTo(URI.create("http://ai:8000"));
    }
}
