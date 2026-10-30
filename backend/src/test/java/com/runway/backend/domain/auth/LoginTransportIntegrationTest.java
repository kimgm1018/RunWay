package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.RefreshTokenFactory;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.MediaType;

class LoginTransportIntegrationTest extends AuthIntegrationSupport {
    @Autowired LettuceConnectionFactory connections;
    @Autowired RefreshTokenStore store;

    @Test
    void actualReplyLossTimesOutWithoutReplayingTheWrite() throws Exception {
        inject(RedisReplyProxy.Fault.LOSE_REPLY);
    }

    @Test
    void actualDisconnectBeforeDispatchDoesNotReplayAndNextRequestRecovers() throws Exception {
        inject(RedisReplyProxy.Fault.DISCONNECT_BEFORE_WRITE);
    }

    private void inject(RedisReplyProxy.Fault fault) throws Exception {
        var script = new DefaultRedisScript<Long>();
        script.setLocation(new ClassPathResource("auth/create-login-family.lua"));
        script.setResultType(Long.class);
        String originalHost = connections.getStandaloneConfiguration().getHostName();
        int originalPort = connections.getStandaloneConfiguration().getPort();
        try (var proxy =
                new RedisReplyProxy(REDIS.getHost(), REDIS.getMappedPort(6379), script.getSha1())) {
            connections.stop();
            // The proxy runs in this JVM, independently of the Docker host's address.
            connections.getStandaloneConfiguration().setHostName(proxy.host());
            connections.getStandaloneConfiguration().setPort(proxy.port());
            connections.start();
            try {
                try (var connection = redis.getConnectionFactory().getConnection()) {
                    connection.scriptingCommands().scriptFlush();
                }
                // Warm up the exact script so the fault targets the real EVALSHA write, not
                // NOSCRIPT.
                store.create(new RefreshTokenFactory().create(user, Instant.now()));
                proxy.arm(fault);
                long started = System.nanoTime();
                mvc.perform(
                                post("/api/v1/auth/login")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                "{\"loginId\":\"runner01\",\"password\":\"Runner9!\"}"))
                        .andExpect(status().isServiceUnavailable())
                        .andExpect(jsonPath("$.accessToken").doesNotExist())
                        .andExpect(jsonPath("$.refreshToken").doesNotExist());
                if (fault == RedisReplyProxy.Fault.LOSE_REPLY)
                    assertThat(System.nanoTime() - started).isGreaterThanOrEqualTo(1_800_000_000L);
                assertThat(proxy.createRequests.get()).isEqualTo(1);
                assertThat(proxy.familyKey.get()).isNotNull();
            } finally {
                connections.stop();
                connections.getStandaloneConfiguration().setHostName(originalHost);
                connections.getStandaloneConfiguration().setPort(originalPort);
                connections.start();
            }
            if (fault == RedisReplyProxy.Fault.LOSE_REPLY) {
                assertThat(redis.opsForHash().get(proxy.familyKey.get(), "state"))
                        .isEqualTo("ACTIVE");
                assertThat(redis.opsForHash().get(proxy.familyKey.get(), "expiresAt"))
                        .isEqualTo(proxy.expiresAt.get());
                assertThat(redis.getExpire(proxy.familyKey.get())).isBetween(2591900L, 2592000L);
            } else assertThat(redis.hasKey(proxy.familyKey.get())).isFalse();
            assertThat(proxy.createRequests.get()).isEqualTo(1);
            mvc.perform(
                            post("/api/v1/auth/login")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            "{\"loginId\":\"runner01\",\"password\":\"Runner9!\"}"))
                    .andExpect(status().isOk());
        }
    }
}
