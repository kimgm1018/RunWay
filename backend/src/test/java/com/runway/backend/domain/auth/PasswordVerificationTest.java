package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.domain.auth.dto.LoginRequest;
import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.service.MemberPasswordHasher;
import com.runway.backend.domain.auth.service.RefreshTokenFactory;
import com.runway.backend.domain.auth.validation.PasswordPolicy;
import com.runway.backend.global.exception.ApiException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

class PasswordVerificationTest {
    static final MemberPasswordHasher HASHER = new MemberPasswordHasher();

    @Test
    void matchesAndRejects() {
        String value = "Runner9!";
        String first = HASHER.encode(value), second = HASHER.encode(value);
        assertThat(first)
                .startsWith("$argon2id$v=19$m=65536,t=3,p=1$")
                .hasSize(97)
                .isNotEqualTo(second);
        assertThat(HASHER.matches(value, first)).isTrue();
        assertThat(HASHER.matches("runner9!", first)).isFalse();
        assertThat(HASHER.matches(value, second)).isTrue();
        assertThatThrownBy(() -> HASHER.matches(value, "malformed"))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> HASHER.matches(value, first.replace("65536", "999999999")))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> HASHER.matches(value, first.replace("argon2id", "argon2i")))
                .isInstanceOf(ApiException.class);
        assertThat(HASHER.matches("😀".repeat(20), HASHER.encode("😀".repeat(20)))).isTrue();
    }

    @Test
    void invalidInputsAndBoundaries() {
        for (Object invalid :
                new Object[] {
                    "a".repeat(7),
                    "a".repeat(21),
                    " Runner9!",
                    "Runner9! ",
                    "Run ner9!",
                    "Run\tner9!",
                    "Run\nner9!",
                    "Run\u00a0ner9!",
                    "Runner9!\ud800",
                    12345678,
                    true
                }) {
            assertThat(PasswordPolicy.accepts(invalid)).isFalse();
        }
        assertThat(PasswordPolicy.accepts(null)).isFalse();
        for (String valid :
                new String[] {
                    "12345678", "!!!!!!!!", "a".repeat(20), "😀".repeat(8), "😀".repeat(20)
                }) {
            assertThat(PasswordPolicy.accepts(valid)).isTrue();
        }
    }

    @Test
    void sensitiveObjectsAreRedactedAndFamiliesIndependent() {
        var factory = new RefreshTokenFactory();
        var now = Instant.now();
        var first = factory.create(1, now);
        var second = factory.create(1, now);
        assertThat(first.value()).hasSize(66).isNotEqualTo(second.value());
        assertThat(first.hash()).hasSize(64).doesNotContain(first.value());
        assertThat(first.expiresAt().getEpochSecond() - first.createdAt().getEpochSecond())
                .isEqualTo(2592000);
        assertThat(first.toString()).doesNotContain(first.value(), first.hash());
        assertThat(new LoginRequest("runner01", "Runner9!").toString()).doesNotContain("Runner9!");
        assertThat(
                        new LoginResponse(
                                        new LoginResponse.User(1, "runner01"),
                                        first.value(),
                                        second.value(),
                                        600,
                                        first.expiresAt(),
                                        false)
                                .toString())
                .doesNotContain(first.value(), second.value());
    }

    @Test
    @Tag("password-performance")
    void boundedConcurrentVerification() throws Exception {
        String encoded = HASHER.encode("Runner9!");
        for (int i = 0; i < 3; i++) HASHER.matches("Runner9!", encoded);
        long[] sequential = new long[30];
        for (int i = 0; i < sequential.length; i++) {
            long start = System.nanoTime();
            assertThat(HASHER.matches("Runner9!", encoded)).isTrue();
            sequential[i] = System.nanoTime() - start;
        }
        java.util.Arrays.sort(sequential);
        assertThat(sequential[28]).isLessThanOrEqualTo(1_000_000_000L);
        var tasks = new ArrayList<Callable<Long>>();
        for (int i = 0; i < 40; i++)
            tasks.add(
                    () -> {
                        long start = System.nanoTime();
                        assertThat(HASHER.matches("Runner9!", encoded)).isTrue();
                        return System.nanoTime() - start;
                    });
        try (var pool = Executors.newFixedThreadPool(8)) {
            var durations =
                    pool.invokeAll(tasks).stream()
                            .map(
                                    future -> {
                                        try {
                                            return future.get();
                                        } catch (Exception ex) {
                                            throw new AssertionError(ex);
                                        }
                                    })
                            .sorted()
                            .toList();
            assertThat(durations.get(37)).isLessThan(2_000_000_000L);
        }
    }
}
