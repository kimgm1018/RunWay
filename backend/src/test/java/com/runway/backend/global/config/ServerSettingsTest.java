package com.runway.backend.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.mock.env.MockEnvironment;

class ServerSettingsTest {

    @ParameterizedTest
    @ValueSource(strings = {"", " "})
    void 빈바인드주소_검증_기동을거부한다(String address) {
        var environment = new MockEnvironment().withProperty("server.address", address);
        assertThatThrownBy(() -> ServerSettings.validate(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("BACKEND_BIND_ADDRESS");

        try (var context = new AnnotationConfigApplicationContext()) {
            context.setEnvironment(environment);
            context.register(ServerSettings.class);
            assertThatThrownBy(context::refresh).hasMessageContaining("BACKEND_BIND_ADDRESS");
            assertThat(context.isActive()).isFalse();
        }
    }

    @Test
    void 지정된바인드주소_검증_통과한다() {
        var environment = new MockEnvironment().withProperty("server.address", "127.0.0.1");
        assertThatCode(() -> ServerSettings.validate(environment)).doesNotThrowAnyException();
    }

    @Test
    void 바인드주소미설정_검증_통과한다() {
        assertThatCode(() -> ServerSettings.validate(new MockEnvironment()))
                .doesNotThrowAnyException();
    }
}
