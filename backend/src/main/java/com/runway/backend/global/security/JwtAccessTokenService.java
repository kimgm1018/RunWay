package com.runway.backend.global.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;

/** Access-token issuing boundary; callers must verify credentials and the login family first. */
public final class JwtAccessTokenService {

    private final JwtEncoder encoder;
    private final Clock clock;

    public JwtAccessTokenService(JwtEncoder encoder, Clock clock) {
        this.encoder = encoder;
        this.clock = clock;
    }

    public IssuedAccessToken issue(long userId, Instant loginExpiresAt) {
        Instant actualNow = clock.instant();
        Instant now = actualNow.truncatedTo(ChronoUnit.SECONDS);
        if (userId <= 0 || loginExpiresAt == null) {
            throw new IllegalArgumentException("검증된 사용자와 로그인 만료시각이 필요합니다.");
        }
        Instant cap = loginExpiresAt.truncatedTo(ChronoUnit.SECONDS);
        Instant expires = now.plusSeconds(600).isBefore(cap) ? now.plusSeconds(600) : cap;
        if (Duration.between(actualNow, expires).compareTo(Duration.ofSeconds(1)) < 0) {
            throw new IllegalArgumentException("인증수단을 발급할 수 없습니다.");
        }
        JwtClaimsSet claims =
                JwtClaimsSet.builder()
                        .issuer(JwtAccessTokenValidator.ISSUER)
                        .audience(java.util.List.of(JwtAccessTokenValidator.AUDIENCE))
                        .subject(Long.toString(userId))
                        .issuedAt(now)
                        .expiresAt(expires)
                        .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).type("JWT").build();
        String value = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new IssuedAccessToken(value, Duration.between(actualNow, expires).toSeconds());
    }

    public record IssuedAccessToken(String accessToken, long expiresInSec) {
        @Override
        public String toString() {
            return "IssuedAccessToken[accessToken=REDACTED, expiresInSec=" + expiresInSec + "]";
        }
    }
}
