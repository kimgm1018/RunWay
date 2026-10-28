package com.runway.backend;

import static org.assertj.core.api.Assertions.assertThat;

import lombok.RequiredArgsConstructor;
import org.junit.jupiter.api.Test;

class BootstrapToolingTest {

    @Test
    void 생성자의존성_주입_참조를보존한다() {
        Object dependency = new Object();
        assertThat(new ConstructorFixture(dependency).dependency).isSameAs(dependency);
    }

    @RequiredArgsConstructor
    private static class ConstructorFixture {
        private final Object dependency;
    }
}
