package com.runway.backend.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.mock.env.MockEnvironment;

class DatabaseSettingsTest {

    @ParameterizedTest
    @CsvSource({
        "spring.datasource.url,BACKEND_DB_URL",
        "spring.datasource.username,BACKEND_DB_USERNAME",
        "spring.datasource.password,BACKEND_DB_PASSWORD"
    })
    void 필수설정누락_검증_변수이름만안내한다(String property, String variable) {
        var environment =
                new MockEnvironment()
                        .withProperty(
                                "spring.datasource.url", "jdbc:postgresql://localhost/isolated")
                        .withProperty("spring.datasource.username", "synthetic-user")
                        .withProperty("spring.datasource.password", "synthetic-test-only")
                        .withProperty(property, " ");
        assertThatThrownBy(() -> DatabaseSettings.validate(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("필수 환경변수 누락: " + variable)
                .hasMessageNotContaining("synthetic-test-only");

        try (var context = new AnnotationConfigApplicationContext()) {
            context.setEnvironment(environment);
            context.register(DatabaseSettings.class);
            assertThatThrownBy(context::refresh).hasMessageContaining(variable);
            assertThat(context.isActive()).isFalse();
        }
    }

    @ParameterizedTest
    @CsvSource(
            delimiter = '|',
            value = {
                "jdbc:postgresql://synthetic-user:synthetic-test-only@localhost/isolated",
                "jdbc:postgresql://localhost/isolated?password=synthetic-test-only",
                "jdbc:postgresql://localhost/isolated?ssl=false&PASSWORD=synthetic-test-only",
                "jdbc:postgresql://localhost/isolated?user=synthetic-user",
                "jdbc:postgresql:isolated?host=localhost&password=synthetic-test-only",
                "jdbc:postgresql:isolated?user=synthetic-user",
                "jdbc:postgresql://localhost/isolated?sslpassword=synthetic-test-only"
            })
    void URL인증정보포함_검증_값을노출하지않고거부한다(String url) {
        var environment =
                new MockEnvironment()
                        .withProperty("spring.datasource.url", url)
                        .withProperty("spring.datasource.username", "synthetic-user")
                        .withProperty("spring.datasource.password", "synthetic-password");
        assertThatThrownBy(() -> DatabaseSettings.validate(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("BACKEND_DB_URL")
                .hasMessageNotContaining("synthetic-test-only")
                .hasMessageNotContaining("synthetic-user");
    }

    @ParameterizedTest
    @CsvSource(
            delimiter = '|',
            value = {
                "jdbc:postgresql://localhost:5432/runway",
                "jdbc:postgresql://localhost/runway?ssl=false&applicationName=runway",
                "jdbc:postgresql://localhost/runway?username_hint=x",
                "jdbc:postgresql://[::1]:5432/runway",
                "jdbc:postgresql:runway?host=localhost&port=5432",
                "jdbc:postgresql://localhost/runway?options=a@b"
            })
    void 인증정보없는URL_검증_통과한다(String url) {
        var environment =
                new MockEnvironment()
                        .withProperty("spring.datasource.url", url)
                        .withProperty("spring.datasource.username", "synthetic-user")
                        .withProperty("spring.datasource.password", "synthetic-password");
        assertThatCode(() -> DatabaseSettings.validate(environment)).doesNotThrowAnyException();
    }
}
