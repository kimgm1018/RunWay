package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.service.RefreshTokenFactory;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.script.DefaultRedisScript;

class RefreshTransportIntegrationTest extends RefreshIntegrationSupport {
    @Autowired LettuceConnectionFactory connections;

    @Test
    void transportFailureIs503ForRefreshAndLogoutWithoutAutomaticReplay() throws Exception {
        for (String endpoint : new String[] {"refresh", "logout"}) {
            for (var fault :
                    new RedisReplyProxy.Fault[] {
                        RedisReplyProxy.Fault.DISCONNECT_BEFORE_WRITE,
                        RedisReplyProxy.Fault.LOSE_REPLY
                    }) {
                inject(endpoint, fault);
            }
        }
    }

    void inject(String endpoint, RedisReplyProxy.Fault fault) throws Exception {
        String scriptName =
                endpoint.equals("refresh") ? "rotate-refresh-token.lua" : "logout-family.lua";
        var script = new DefaultRedisScript<Long>();
        script.setLocation(new ClassPathResource("auth/" + scriptName));
        script.setResultType(Long.class);
        var warm = grant();
        if (endpoint.equals("refresh")) refresh.refresh(warm.value());
        else logout.logout(warm.value());
        var token = grant();
        String host = connections.getStandaloneConfiguration().getHostName();
        int port = connections.getStandaloneConfiguration().getPort();
        try (var proxy =
                new RedisReplyProxy(REDIS.getHost(), REDIS.getMappedPort(6379), script.getSha1())) {
            connections.stop();
            connections.getStandaloneConfiguration().setHostName(proxy.host());
            connections.getStandaloneConfiguration().setPort(proxy.port());
            connections.start();
            try {
                store.find(RefreshTokenFactory.parse(token.value()));
                proxy.arm(fault);
                request(endpoint, token.value())
                        .andExpect(status().isServiceUnavailable())
                        .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                        .andExpect(jsonPath("$.details").isEmpty())
                        .andExpect(jsonPath("$.accessToken").doesNotExist())
                        .andExpect(jsonPath("$.refreshToken").doesNotExist());
                assertThat(proxy.createRequests.get()).isEqualTo(1);
            } finally {
                connections.stop();
                connections.getStandaloneConfiguration().setHostName(host);
                connections.getStandaloneConfiguration().setPort(port);
                connections.start();
            }
            if (endpoint.equals("logout")) {
                assertThat(redis.opsForHash().get(key(token), "state"))
                        .isEqualTo(
                                fault == RedisReplyProxy.Fault.LOSE_REPLY ? "REVOKED" : "ACTIVE");
                // Retrying logout is explicitly safe and must complete after connectivity recovers.
                request("logout", token.value()).andExpect(status().isNoContent());
                invalid(token.value());
            } else {
                assertThat(redis.opsForHash().hasKey(key(token), "used:" + token.hash()))
                        .isEqualTo(fault == RedisReplyProxy.Fault.LOSE_REPLY);
            }
        }
    }
}
