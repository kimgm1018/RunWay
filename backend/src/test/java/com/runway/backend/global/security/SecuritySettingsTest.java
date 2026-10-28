package com.runway.backend.global.security;

import static org.assertj.core.api.Assertions.*;

import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

class SecuritySettingsTest {

    static MockEnvironment local() {
        return new MockEnvironment()
                .withProperty("runway.security.jwt-secret-base64", SecurityTestSupport.KEY)
                .withProperty("runway.security.docs-access-mode", "local")
                .withProperty("server.address", "127.0.0.1");
    }

    static Stream<MockEnvironment> invalid() {
        return Stream.of(
                new MockEnvironment(),
                local().withProperty("runway.security.jwt-secret-base64", "broken-secret"),
                local().withProperty("runway.security.jwt-secret-base64", "YQ=="),
                local().withProperty("runway.security.docs-access-mode", ""),
                local().withProperty("runway.security.docs-access-mode", "typo"),
                local().withProperty("server.address", "0.0.0.0"),
                local().withProperty("runway.security.docs-access-mode", "password"),
                local().withProperty("runway.security.docs-access-mode", "password")
                        .withProperty("runway.security.docs-username", "test-docs")
                        .withProperty("runway.security.docs-password-hash", "do-not-print-this"));
    }

    @ParameterizedTest
    @MethodSource("invalid")
    void 잘못된설정은_값없이_기동거절한다(MockEnvironment environment) {
        assertThatThrownBy(() -> new SecuritySettings(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("BACKEND_")
                .hasMessageNotContaining("broken-secret")
                .hasMessageNotContaining("do-not-print-this");
        new ApplicationContextRunner()
                .withInitializer(context -> context.setEnvironment(environment))
                .withUserConfiguration(SettingsOnly.class)
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void 루프백로컬과_유효문서인증은_기동한다() {
        for (MockEnvironment environment :
                new MockEnvironment[] {
                    local(),
                    new MockEnvironment()
                            .withProperty(
                                    "runway.security.jwt-secret-base64", SecurityTestSupport.KEY)
                            .withProperty("runway.security.docs-username", "test-docs")
                            .withProperty(
                                    "runway.security.docs-password-hash",
                                    "{bcrypt}"
                                            + new BCryptPasswordEncoder(4)
                                                    .encode("test-docs-password"))
                }) {
            new ApplicationContextRunner()
                    .withInitializer(context -> context.setEnvironment(environment))
                    .withUserConfiguration(SettingsOnly.class)
                    .run(context -> assertThat(context).hasNotFailed());
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class SettingsOnly {
        @Bean
        SecuritySettings settings(Environment environment) {
            return new SecuritySettings(environment);
        }
    }
}
