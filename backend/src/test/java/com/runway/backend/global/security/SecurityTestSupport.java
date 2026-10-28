package com.runway.backend.global.security;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

public final class SecurityTestSupport {

    public static final String KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

    private SecurityTestSupport() {}

    public static String bearer(long userId) {
        var key = new SecretKeySpec(Base64.getDecoder().decode(KEY), "HmacSHA256");
        var issuer =
                new JwtAccessTokenService(
                        new NimbusJwtEncoder(new ImmutableSecret<>(key)), Clock.systemUTC());
        return "Bearer " + issuer.issue(userId, Instant.now().plusSeconds(3600)).accessToken();
    }

    @org.springframework.boot.test.context.TestConfiguration(proxyBeanMethods = false)
    public static class AuthenticatedRequests {
        @org.springframework.context.annotation.Bean
        org.springframework.boot.webmvc.test.autoconfigure.MockMvcBuilderCustomizer
                authenticatedRequest() {
            return builder ->
                    builder.defaultRequest(
                            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                                            "/")
                                    .header("Authorization", bearer(1)));
        }
    }
}
