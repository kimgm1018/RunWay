package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.api.Test;

class RefreshReuseIntegrationTest extends RefreshIntegrationSupport {
    @Test
    void revokesOnlyReusedFamily() {
        var old = grant();
        var independent = grant();
        var next = refresh.refresh(old.value());
        invalid(old.value());
        invalid(next.refreshToken());
        assertThat(redis.opsForHash().get(key(old), "state")).isEqualTo("REVOKED");
        assertThat(refresh.refresh(independent.value()).refreshToken()).isNotEmpty();
    }
}
