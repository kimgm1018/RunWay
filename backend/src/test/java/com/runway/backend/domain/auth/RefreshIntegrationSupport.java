package com.runway.backend.domain.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.auth.service.*;
import com.runway.backend.domain.auth.service.RefreshTokenFactory.IssuedRefreshToken;
import com.runway.backend.global.security.JwtAccessTokenService;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import tools.jackson.databind.json.JsonMapper;

import java.time.Instant;
import java.util.Map;

abstract class RefreshIntegrationSupport extends AuthIntegrationSupport {
    @Autowired RefreshTokenFactory factory;
    @Autowired RefreshTokenStore store;
    @Autowired RefreshService refresh;
    @Autowired LogoutService logout;
    @Autowired JwtAccessTokenService access;
    @Autowired JsonMapper mapper;

    IssuedRefreshToken grant() {
        var token = factory.create(user, Instant.now());
        store.create(token);
        return token;
    }

    ResultActions request(String endpoint, String token) throws Exception {
        return mvc.perform(
                post("/api/v1/auth/" + endpoint)
                        .header("Authorization", "Bearer expired-or-malformed")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("refreshToken", token))));
    }

    String key(IssuedRefreshToken token) {
        return RefreshTokenStore.familyKey(token.familyId());
    }

    void invalid(String token) {
        LoginAttemptStoreIntegrationTest.assertCode(
                () -> refresh.refresh(token), "INVALID_REFRESH_TOKEN");
    }
}
