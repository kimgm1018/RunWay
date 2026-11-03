package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.service.RefreshTokenFactory;

import org.junit.jupiter.api.Test;

import java.time.Instant;

class RefreshApiIntegrationTest extends RefreshIntegrationSupport {
    @Test
    void rotatesAndPreservesAbsoluteExpiry() throws Exception {
        var original = grant();
        long ttl = redis.getExpire(key(original));
        var body =
                mapper.readTree(
                        request("refresh", original.value())
                                .andExpect(status().isOk())
                                .andExpect(header().string("Cache-Control", "no-store"))
                                .andExpect(cookie().doesNotExist("JSESSIONID"))
                                .andReturn()
                                .getResponse()
                                .getContentAsString());
        assertThat(body.size()).isEqualTo(4);
        assertThat(body.get("refreshToken").asString()).isNotEqualTo(original.value());
        assertThat(body.get("expiresInSec").asLong()).isBetween(1L, 600L);
        assertThat(Instant.parse(body.get("refreshExpiresAt").asString()))
                .isEqualTo(original.expiresAt());
        var next = RefreshTokenFactory.parse(body.get("refreshToken").asString());
        assertThat(next.familyId()).isEqualTo(original.familyId());
        assertThat(redis.opsForHash().get(key(original), "currentTokenHash"))
                .isEqualTo(next.hash());
        assertThat(redis.opsForHash().get(key(original), "used:" + original.hash())).isEqualTo("1");
        assertThat(redis.getExpire(key(original))).isBetween(ttl - 3, ttl);
        assertThat(
                        redis.opsForZSet()
                                .score(
                                        com.runway.backend.domain.auth.repository.RefreshTokenStore
                                                .userKey(user),
                                        original.familyId()))
                .isEqualTo((double) original.expiresAt().getEpochSecond());
    }

    @Test
    void rejectsInvalidTokensWithoutRevokingUnrelatedFamily() throws Exception {
        var token = grant();
        var other = factory.rotate(user, token.familyId(), token.createdAt(), token.expiresAt());
        for (String value :
                new String[] {
                    "not-registered", other.value(), " " + token.value(), token.value() + " "
                }) {
            request("refresh", value)
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("INVALID_REFRESH_TOKEN"))
                    .andExpect(jsonPath("$.details").isEmpty());
        }
        assertThat(redis.opsForHash().get(key(token), "state")).isEqualTo("ACTIVE");
        for (String state : new String[] {"PENDING", "REVOKED"}) {
            redis.opsForHash().put(key(token), "state", state);
            invalid(token.value());
        }
        redis.opsForHash().put(key(token), "state", "ACTIVE");
        redis.persist(key(token));
        invalid(token.value());
        redis.delete(key(token));
        invalid(token.value());
    }
}
