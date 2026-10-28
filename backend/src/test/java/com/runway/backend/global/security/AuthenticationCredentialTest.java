package com.runway.backend.global.security;

import static org.assertj.core.api.Assertions.*;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSObject;
import com.nimbusds.jose.Payload;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.Stream;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

class AuthenticationCredentialTest {

    static final Instant NOW = Instant.parse("2026-10-28T00:00:00Z");
    static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    static final byte[] KEY = Base64.getDecoder().decode(SecurityTestSupport.KEY);

    static NimbusJwtDecoder decoder(Clock clock) {
        var decoder =
                NimbusJwtDecoder.withSecretKey(new SecretKeySpec(KEY, "HmacSHA256"))
                        .macAlgorithm(MacAlgorithm.HS256)
                        .build();
        decoder.setJwtValidator(new JwtAccessTokenValidator(clock));
        return decoder;
    }

    static JwtAccessTokenService issuer(Clock clock) {
        return new JwtAccessTokenService(new NimbusJwtEncoder(new ImmutableSecret<>(KEY)), clock);
    }

    static JWTClaimsSet.Builder validClaims() {
        return new JWTClaimsSet.Builder()
                .issuer("runway-backend")
                .audience("runway-api")
                .subject("17")
                .issueTime(Date.from(NOW))
                .expirationTime(Date.from(NOW.plusSeconds(600)));
    }

    static String sign(JWTClaimsSet claims) throws Exception {
        SignedJWT jwt =
                new SignedJWT(
                        new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).build(),
                        claims);
        jwt.sign(new MACSigner(KEY));
        return jwt.serialize();
    }

    @ParameterizedTest
    @ValueSource(longs = {600, 599, 1})
    void 발급_검증과_절대상한(long remaining) {
        var issued = issuer(CLOCK).issue(17, NOW.plusSeconds(remaining));
        var jwt = decoder(CLOCK).decode(issued.accessToken());
        assertThat(jwt.getSubject()).isEqualTo("17");
        assertThat(jwt.getExpiresAt()).isEqualTo(NOW.plusSeconds(remaining));
        assertThat(issued.expiresInSec()).isEqualTo(remaining);
        assertThat(issued.toString()).doesNotContain(issued.accessToken());
    }

    @Test
    void 만료_직전_정각_이후를_구분한다() {
        String token = issuer(CLOCK).issue(17, NOW.plusSeconds(600)).accessToken();
        assertThatCode(
                        () ->
                                decoder(
                                                Clock.fixed(
                                                        NOW.plusSeconds(600).minusNanos(1),
                                                        ZoneOffset.UTC))
                                        .decode(token))
                .doesNotThrowAnyException();
        for (Instant time : new Instant[] {NOW.plusSeconds(600), NOW.plusSeconds(601)}) {
            assertThatThrownBy(() -> decoder(Clock.fixed(time, ZoneOffset.UTC)).decode(token))
                    .isInstanceOf(RuntimeException.class);
        }
    }

    @Test
    void 실제잔여_1초미만과_잘못된사용자는_발급거절한다() {
        for (Instant cap : new Instant[] {NOW, NOW.minusSeconds(1), NOW.plusMillis(999)}) {
            assertThatThrownBy(() -> issuer(CLOCK).issue(17, cap))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(
                        () ->
                                issuer(Clock.fixed(NOW.plusMillis(900), ZoneOffset.UTC))
                                        .issue(17, NOW.plusSeconds(1)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> issuer(CLOCK).issue(0, NOW.plusSeconds(600)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    static Stream<JWTClaimsSet> invalidClaims() {
        return Stream.of(
                validClaims().issuer("wrong").build(),
                validClaims().issuer(null).build(),
                validClaims().audience("wrong").build(),
                validClaims().audience((String) null).build(),
                validClaims().subject(null).build(),
                validClaims().subject("0").build(),
                validClaims().subject("-1").build(),
                validClaims().subject("9223372036854775808").build(),
                validClaims().subject("runner").build(),
                validClaims().issueTime(null).build(),
                validClaims().issueTime(Date.from(NOW.plusSeconds(1))).build(),
                validClaims().expirationTime(null).build(),
                validClaims().expirationTime(Date.from(NOW)).build(),
                validClaims().expirationTime(Date.from(NOW.plusSeconds(601))).build(),
                validClaims().notBeforeTime(Date.from(NOW.plusSeconds(1))).build());
    }

    @ParameterizedTest
    @MethodSource("invalidClaims")
    void 잘못된_claim은_거절한다(JWTClaimsSet claims) throws Exception {
        String token = sign(claims);
        assertThatThrownBy(() -> decoder(CLOCK).decode(token)).isInstanceOf(RuntimeException.class);
    }

    @Test
    void 무서명_다른알고리즘_변조_다른키는_거절한다() throws Exception {
        String plain = new PlainJWT(validClaims().build()).serialize();
        assertThatThrownBy(() -> decoder(CLOCK).decode(plain)).isInstanceOf(RuntimeException.class);
        var otherAlgorithm =
                new SignedJWT(new JWSHeader(JWSAlgorithm.HS512), validClaims().build());
        otherAlgorithm.sign(new MACSigner(new byte[64]));
        assertThatThrownBy(() -> decoder(CLOCK).decode(otherAlgorithm.serialize()))
                .isInstanceOf(RuntimeException.class);
        var otherKey = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), validClaims().build());
        otherKey.sign(new MACSigner(new byte[32]));
        assertThatThrownBy(() -> decoder(CLOCK).decode(otherKey.serialize()))
                .isInstanceOf(RuntimeException.class);
        String token = sign(validClaims().build());
        String[] parts = token.split("\\.");
        String tampered =
                parts[0]
                        + "."
                        + Base64.getUrlEncoder()
                                .withoutPadding()
                                .encodeToString(
                                        "{\"sub\":\"99\"}"
                                                .getBytes(java.nio.charset.StandardCharsets.UTF_8))
                        + "."
                        + parts[2];
        assertThatThrownBy(() -> decoder(CLOCK).decode(tampered))
                .isInstanceOf(RuntimeException.class);
    }

    @Test
    void 원문숫자주체와_소수시간은_Nimbus정규화전에_거절한다() throws Exception {
        for (var invalid :
                Map.<String, Object>of(
                                "sub",
                                17L,
                                "iat",
                                NOW.getEpochSecond() + 0.5,
                                "exp",
                                NOW.plusSeconds(600).getEpochSecond() + 0.5,
                                "nbf",
                                NOW.getEpochSecond() + 0.5,
                                "iss",
                                17L,
                                "aud",
                                java.util.List.of("runway-api", 17L))
                        .entrySet()) {
            var claims =
                    new HashMap<String, Object>(
                            Map.of(
                                    "iss",
                                    "runway-backend",
                                    "aud",
                                    "runway-api",
                                    "sub",
                                    "17",
                                    "iat",
                                    NOW.getEpochSecond(),
                                    "exp",
                                    NOW.plusSeconds(600).getEpochSecond()));
            claims.put(invalid.getKey(), invalid.getValue());
            var signed =
                    new JWSObject(
                            new JWSHeader.Builder(JWSAlgorithm.HS256)
                                    .type(JOSEObjectType.JWT)
                                    .build(),
                            new Payload(claims));
            signed.sign(new MACSigner(KEY));
            assertThatThrownBy(() -> decoder(CLOCK).decode(signed.serialize()))
                    .isInstanceOf(RuntimeException.class);
        }
    }

    @Test
    void Date변환에서_오버플로한_원문시각은_거절한다() throws Exception {
        long wrap = 1L << 61;
        for (String field : java.util.List.of("iat", "exp", "nbf")) {
            var claims =
                    new HashMap<String, Object>(
                            Map.of(
                                    "iss",
                                    "runway-backend",
                                    "aud",
                                    "runway-api",
                                    "sub",
                                    "17",
                                    "iat",
                                    NOW.getEpochSecond(),
                                    "exp",
                                    NOW.plusSeconds(600).getEpochSecond()));
            claims.put(
                    field,
                    (field.equals("exp")
                                    ? NOW.plusSeconds(600).getEpochSecond()
                                    : NOW.getEpochSecond())
                            + wrap);
            var signed =
                    new JWSObject(
                            new JWSHeader.Builder(JWSAlgorithm.HS256)
                                    .type(JOSEObjectType.JWT)
                                    .build(),
                            new Payload(claims));
            signed.sign(new MACSigner(KEY));
            assertThatThrownBy(() -> decoder(CLOCK).decode(signed.serialize()))
                    .isInstanceOf(RuntimeException.class);
        }
    }
}
