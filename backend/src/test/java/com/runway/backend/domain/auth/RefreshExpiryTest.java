package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.runway.backend.domain.auth.repository.*;
import com.runway.backend.domain.auth.service.*;
import com.runway.backend.global.security.*;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import java.time.*;

class RefreshExpiryTest {
    @Test
    void enforcesOneSecondAndAbsoluteDeadline() throws Exception {
        Instant now = Instant.parse("2026-10-30T00:00:00Z");
        var clock = Clock.fixed(now, ZoneOffset.UTC);
        var jwt =
                new JwtAccessTokenService(
                        new NimbusJwtEncoder(new ImmutableSecret<>(new byte[32])), clock);
        var users = mock(AuthUserRepository.class);
        var store = mock(RefreshTokenStore.class);
        var factory = new RefreshTokenFactory();
        when(users.lock(1))
                .thenReturn(
                        java.util.Optional.of(
                                new AuthUserRepository.Account(1, "runner01", "unused", "ACTIVE")));
        var issuance = new RefreshIssuanceService(users, store, factory, jwt, clock);
        for (int remaining : new int[] {600, 1}) {
            var cap = now.plusSeconds(remaining);
            var original = factory.create(1, now.minusSeconds(200));
            var result =
                    issuance.issue(
                            RefreshTokenFactory.parse(original.value()),
                            new RefreshTokenStore.Family(1, now.minusSeconds(200), cap));
            assertThat(result.refreshExpiresAt()).isEqualTo(cap);
            assertThat(result.expiresInSec()).isEqualTo(remaining);
            assertThat(
                            com.nimbusds.jwt.SignedJWT.parse(result.accessToken())
                                    .getJWTClaimsSet()
                                    .getExpirationTime()
                                    .toInstant())
                    .isEqualTo(cap);
        }
        for (Instant instant : new Instant[] {now, now.minusSeconds(1), now.plusMillis(999)}) {
            var token = factory.create(1, now.minusSeconds(20));
            LoginAttemptStoreIntegrationTest.assertCode(
                    () ->
                            issuance.issue(
                                    RefreshTokenFactory.parse(token.value()),
                                    new RefreshTokenStore.Family(1, now.minusSeconds(20), instant)),
                    "INVALID_REFRESH_TOKEN");
        }
        verify(store, times(2)).rotate(any(), any(), any());
    }
}
