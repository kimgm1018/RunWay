package com.runway.backend.domain.course.candidate;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonLineString;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * C01 후보 서명(courses.md C10). 서버는 후보를 보관하지 않고, 발급한 후보와 저장 요청 후보가 값까지 같은지 서명으로 확인한다.
 *
 * <p>토큰은 {@code v1.<만료 epoch초>.<base64url HMAC-SHA256>}이며 MAC 입력은 사용자 ID·만료·정규화 후보의 SHA-256이다.
 * 키는 JWT 서명 비밀값에서 HKDF-SHA256(info={@value #INFO})으로 파생해 용도를 분리한다. 정규화는 JSON 표기(공백·키 순서·
 * {@code 100}과 {@code 100.0})에 영향받지 않고 값만 본다.
 */
@Component
public class CourseCandidateSigner {

    static final String INFO = "runway-course-candidate-v1";
    private static final String VERSION = "v1";
    private static final int MAC_LENGTH = 32;
    private static final Pattern TOKEN =
            Pattern.compile("v1\\.([1-9][0-9]{0,11})\\.([A-Za-z0-9_-]{43})");

    private final byte[] key;
    private final Clock clock;
    private final Duration ttl;

    public CourseCandidateSigner(
            Environment environment,
            Clock clock,
            @Value("${runway.course.candidate-ttl:PT30M}") Duration ttl) {
        // 형식·길이 검증은 SecuritySettings가 기동 시 수행한다. 여기서는 값을 읽기만 한다.
        byte[] secret;
        try {
            secret =
                    Base64.getDecoder()
                            .decode(environment.getProperty("runway.security.jwt-secret-base64", ""));
        } catch (IllegalArgumentException ex) {
            // 원인 예외 메시지에 비밀값 일부가 들어갈 수 있어 붙이지 않는다.
            throw new IllegalStateException("BACKEND_JWT_SECRET_BASE64 형식 오류");
        }
        if (secret.length < 32) {
            throw new IllegalStateException("BACKEND_JWT_SECRET_BASE64 형식 오류");
        }
        if (ttl == null || ttl.isNegative() || ttl.isZero()) {
            throw new IllegalStateException("runway.course.candidate-ttl은 양수여야 합니다.");
        }
        this.key = hkdf(secret, INFO.getBytes(StandardCharsets.UTF_8));
        this.clock = clock;
        this.ttl = ttl;
    }

    /** 후보 하나의 서명 토큰을 만든다. */
    public String issue(
            long userId,
            GeoJsonLineString route,
            BigDecimal distanceM,
            List<GradeSegment> elevationProfile) {
        long expiresAt = clock.instant().plus(ttl).getEpochSecond();
        byte[] mac = mac(userId, expiresAt, canonical(route, distanceM, elevationProfile));
        return VERSION
                + "."
                + expiresAt
                + "."
                + Base64.getUrlEncoder().withoutPadding().encodeToString(mac);
    }

    /**
     * 서명·만료·사용자를 확인한다. 실패 원인은 구분하지 않고 {@code 422 COURSE_CANDIDATE_INVALID}로 거절한다.
     */
    public void verify(
            long userId,
            String token,
            GeoJsonLineString route,
            BigDecimal distanceM,
            List<GradeSegment> elevationProfile) {
        var matcher = token == null ? null : TOKEN.matcher(token);
        if (matcher == null || !matcher.matches()) {
            throw invalid();
        }
        long expiresAt = Long.parseLong(matcher.group(1));
        byte[] presented = Base64.getUrlDecoder().decode(matcher.group(2));
        String canonical;
        try {
            canonical = canonical(route, distanceM, elevationProfile);
        } catch (RuntimeException ex) {
            throw invalid();
        }
        byte[] expected = mac(userId, expiresAt, canonical);
        // 서명 일치를 먼저 상수 시간으로 확인한 뒤 만료를 본다(만료 값도 서명 대상).
        if (presented.length != MAC_LENGTH || !MessageDigest.isEqual(expected, presented)) {
            throw invalid();
        }
        if (clock.instant().getEpochSecond() >= expiresAt) {
            throw invalid();
        }
    }

    /** 값 기준 정규화. 좌표는 double 최단 표기(-0.0→0.0), 거리·경사는 0을 뗀 십진 표기. */
    static String canonical(
            GeoJsonLineString route, BigDecimal distanceM, List<GradeSegment> elevationProfile) {
        StringBuilder out = new StringBuilder(64 * (route.positionCount() + elevationProfile.size()));
        out.append("route:");
        for (List<Double> position : route.coordinates()) {
            out.append(number(position.get(0))).append(',').append(number(position.get(1))).append(';');
        }
        out.append("\ndistanceM:").append(number(distanceM)).append("\nelevationProfile:");
        for (GradeSegment segment : elevationProfile) {
            out.append(number(segment.startDistanceM()))
                    .append(',')
                    .append(number(segment.endDistanceM()))
                    .append(',')
                    .append(number(segment.gradePercent()))
                    .append(';');
        }
        return out.toString();
    }

    private static String number(double value) {
        if (!Double.isFinite(value)) {
            throw new IllegalArgumentException("non-finite");
        }
        return value == 0.0 ? "0.0" : Double.toString(value);
    }

    /** 십진 자릿수 상한. 호출부 검증을 통과한 거리·경사는 이 안이며, 거대한 지수 입력의 문자열 확장을 막는 방어선이다. */
    private static final int MAX_DIGITS = 64;

    private static String number(BigDecimal value) {
        if (value == null) {
            throw new IllegalArgumentException("null");
        }
        if (value.signum() == 0) {
            return "0";
        }
        BigDecimal stripped = value.stripTrailingZeros();
        if (Math.abs((long) stripped.scale()) > MAX_DIGITS || stripped.precision() > MAX_DIGITS) {
            throw new IllegalArgumentException("too many digits");
        }
        return stripped.toPlainString();
    }

    private byte[] mac(long userId, long expiresAt, String canonical) {
        try {
            byte[] digest =
                    MessageDigest.getInstance("SHA-256")
                            .digest(canonical.getBytes(StandardCharsets.UTF_8));
            Mac hmac = Mac.getInstance("HmacSHA256");
            hmac.init(new SecretKeySpec(key, "HmacSHA256"));
            String input =
                    INFO + "\n" + userId + "\n" + expiresAt + "\n" + HexFormat.of().formatHex(digest);
            return hmac.doFinal(input.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("HmacSHA256 unavailable", ex);
        }
    }

    /** RFC 5869 HKDF-SHA256, salt 없음(0 바이트열), 출력 32바이트. */
    static byte[] hkdf(byte[] inputKey, byte[] info) {
        try {
            Mac extract = Mac.getInstance("HmacSHA256");
            extract.init(new SecretKeySpec(new byte[MAC_LENGTH], "HmacSHA256"));
            byte[] prk = extract.doFinal(inputKey);
            Mac expand = Mac.getInstance("HmacSHA256");
            expand.init(new SecretKeySpec(prk, "HmacSHA256"));
            expand.update(info);
            expand.update((byte) 1);
            return expand.doFinal();
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("HmacSHA256 unavailable", ex);
        }
    }

    private static ApiException invalid() {
        return new ApiException(ErrorCode.COURSE_CANDIDATE_INVALID);
    }
}
