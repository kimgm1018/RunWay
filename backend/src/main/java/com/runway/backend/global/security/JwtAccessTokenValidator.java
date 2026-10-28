package com.runway.backend.global.security;

import com.nimbusds.jwt.SignedJWT;
import java.text.ParseException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

public final class JwtAccessTokenValidator implements OAuth2TokenValidator<Jwt> {

    public static final String ISSUER = "runway-backend";
    public static final String AUDIENCE = "runway-api";
    private final Clock clock;

    public JwtAccessTokenValidator(Clock clock) {
        this.clock = clock;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        try {
            // Nimbus normalizes registered claims; enforce their JSON types before trusting them.
            Map<String, Object> original =
                    SignedJWT.parse(jwt.getTokenValue()).getPayload().toJSONObject();
            if (!(original.get("sub") instanceof String)
                    || !(original.get("iss") instanceof String)
                    || !integer(original.get("iat"))
                    || !integer(original.get("exp"))
                    || (original.containsKey("nbf") && !integer(original.get("nbf")))
                    || !validAudienceType(original.get("aud"))) {
                return invalid();
            }
            Instant now = clock.instant();
            Instant issued = jwt.getIssuedAt();
            Instant expires = jwt.getExpiresAt();
            String subject = jwt.getSubject();
            List<String> audience = jwt.getAudience();
            if (!"JWT".equals(jwt.getHeaders().get("typ"))
                    || !"HS256".equals(jwt.getHeaders().get("alg"))
                    || !ISSUER.equals(jwt.getClaimAsString("iss"))
                    || audience == null
                    || !audience.contains(AUDIENCE)
                    || subject == null
                    || !subject.matches("[1-9][0-9]*")
                    || Long.parseLong(subject) <= 0
                    || issued == null
                    || expires == null
                    || !sameEpochSecond(original.get("iat"), issued)
                    || !sameEpochSecond(original.get("exp"), expires)
                    || (original.containsKey("nbf")
                            && !sameEpochSecond(original.get("nbf"), jwt.getNotBefore()))
                    || issued.getNano() != 0
                    || expires.getNano() != 0
                    || issued.isAfter(now)
                    || !now.isBefore(expires)
                    || !issued.isBefore(expires)
                    || expires.isAfter(issued.plusSeconds(600))
                    || (jwt.getNotBefore() != null && now.isBefore(jwt.getNotBefore()))) {
                return invalid();
            }
            return OAuth2TokenValidatorResult.success();
        } catch (ParseException | RuntimeException exception) {
            return invalid();
        }
    }

    private static boolean integer(Object value) {
        return value instanceof Long
                || value instanceof Integer
                || value instanceof java.math.BigInteger;
    }

    private static boolean sameEpochSecond(Object raw, Instant converted) {
        return converted != null
                && new java.math.BigInteger(raw.toString())
                        .equals(java.math.BigInteger.valueOf(converted.getEpochSecond()));
    }

    private static boolean validAudienceType(Object value) {
        return value instanceof String
                || (value instanceof List<?> values
                        && values.stream().allMatch(String.class::isInstance));
    }

    private static OAuth2TokenValidatorResult invalid() {
        return OAuth2TokenValidatorResult.failure(
                new OAuth2Error("invalid_token", "인증이 필요합니다.", null));
    }
}
