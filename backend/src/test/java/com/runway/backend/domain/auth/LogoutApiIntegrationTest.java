package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;

class LogoutApiIntegrationTest extends RefreshIntegrationSupport {
    @Test
    void revokesCurrentOrUsedTokenIdempotently() throws Exception {
        for (boolean rotated : new boolean[] {false, true}) {
            var token = grant();
            var other = grant();
            var forged =
                    factory.rotate(user, token.familyId(), token.createdAt(), token.expiresAt());
            request("logout", forged.value()).andExpect(status().isNoContent());
            assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("ACTIVE");
            String current =
                    rotated ? refresh.refresh(token.value()).refreshToken() : token.value();
            request("logout", token.value())
                    .andExpect(status().isNoContent())
                    .andExpect(content().string(""));
            request("logout", token.value()).andExpect(status().isNoContent());
            invalid(current);
            assertThat(refresh.refresh(other.value()).accessToken()).isNotEmpty();
        }
        request("logout", "unregistered").andExpect(status().isNoContent());
        var expired = grant();
        redis.delete(key(expired));
        request("logout", expired.value()).andExpect(status().isNoContent());
    }
}
