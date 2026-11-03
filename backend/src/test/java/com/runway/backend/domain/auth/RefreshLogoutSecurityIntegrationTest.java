package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;

class RefreshLogoutSecurityIntegrationTest extends RefreshIntegrationSupport {
    @Test
    void preservesAccessTokenPolicy() throws Exception {
        var token = grant();
        String jwt = access.issue(user, token.expiresAt()).accessToken();
        var parsed = com.nimbusds.jwt.SignedJWT.parse(jwt).getJWTClaimsSet();
        var springJwt =
                org.springframework.security.oauth2.jwt.Jwt.withTokenValue(jwt)
                        .header("alg", "HS256")
                        .header("typ", "JWT")
                        .claims(
                                claims -> {
                                    claims.put("iss", "runway-backend");
                                    claims.put("aud", java.util.List.of("runway-api"));
                                    claims.put("sub", Long.toString(user));
                                })
                        .issuedAt(parsed.getIssueTime().toInstant())
                        .expiresAt(parsed.getExpirationTime().toInstant())
                        .build();
        request("refresh", token.value()).andExpect(status().isOk());
        request("logout", token.value()).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/users/me/crews").header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk());
        mvc.perform(
                        get("/api/v1/users/me/crews")
                                .header("Authorization", "Bearer expired-or-malformed"))
                .andExpect(status().isUnauthorized());
        var deadline = springJwt.getExpiresAt();
        assertThat(
                        new com.runway.backend.global.security.JwtAccessTokenValidator(
                                        java.time.Clock.fixed(
                                                deadline.minusSeconds(1), java.time.ZoneOffset.UTC))
                                .validate(springJwt)
                                .hasErrors())
                .isFalse();
        assertThat(
                        new com.runway.backend.global.security.JwtAccessTokenValidator(
                                        java.time.Clock.fixed(deadline, java.time.ZoneOffset.UTC))
                                .validate(springJwt)
                                .hasErrors())
                .isTrue();
    }
}
