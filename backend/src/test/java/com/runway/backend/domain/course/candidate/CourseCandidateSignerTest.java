package com.runway.backend.domain.course.candidate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonLineString;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/** T-3·T-8: 후보 서명 발급·검증과 정규화. */
public class CourseCandidateSignerTest {

    /** 테스트 전용 합성 키(src/test/resources/application.properties와 같은 값). */
    static final String TEST_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

    private static final long USER = 11L;
    private static final GeoJsonLineString ROUTE =
            GeoJsonLineString.of(
                    List.of(
                            List.of(129.0756, 35.1796),
                            List.of(129.0761234567891, 35.18),
                            List.of(129.077, 35.1801)));
    private static final BigDecimal DISTANCE = new BigDecimal("150.00");
    private static final List<GradeSegment> PROFILE =
            List.of(
                    new GradeSegment(BigDecimal.ZERO, new BigDecimal("100"), new BigDecimal("0.8000")),
                    new GradeSegment(
                            new BigDecimal("100"), new BigDecimal("150.00"), new BigDecimal("-1.25")));

    private final MutableClock clock = new MutableClock(Instant.parse("2026-11-05T00:00:00Z"));
    private final CourseCandidateSigner signer = signer(clock);

    /** 다른 테스트가 쓰는 30분 서명기. */
    public static CourseCandidateSigner signer(Clock clock) {
        return new CourseCandidateSigner(
                new MockEnvironment().withProperty("runway.security.jwt-secret-base64", TEST_SECRET),
                clock,
                Duration.ofMinutes(30));
    }

    private static ApiException invalid(Runnable action) {
        try {
            action.run();
        } catch (ApiException ex) {
            return ex;
        }
        throw new AssertionError("ApiException이 발생해야 합니다.");
    }

    @Test
    void 발급한_후보는_같은_사용자와_같은_값으로_검증된다() {
        String token = signer.issue(USER, ROUTE, DISTANCE, PROFILE);

        assertThat(token).matches("v1\\.\\d+\\.[A-Za-z0-9_-]{43}");
        long expiresAt = Long.parseLong(token.split("\\.")[1]);
        assertThat(expiresAt).isEqualTo(clock.instant().plus(Duration.ofMinutes(30)).getEpochSecond());
        assertThatCode(() -> signer.verify(USER, token, ROUTE, DISTANCE, PROFILE))
                .doesNotThrowAnyException();
    }

    @Test
    void 좌표_거리_경사_사용자가_하나라도_다르면_거절한다() {
        String token = signer.issue(USER, ROUTE, DISTANCE, PROFILE);

        List<List<Double>> moved = new ArrayList<>(ROUTE.coordinates());
        moved.set(1, List.of(Math.nextUp(129.0761234567891), 35.18)); // 1ulp 차이
        List<GradeSegment> regraded = new ArrayList<>(PROFILE);
        regraded.set(0, new GradeSegment(BigDecimal.ZERO, new BigDecimal("100"), new BigDecimal("0.81")));
        List<List<Double>> reversed = new ArrayList<>(ROUTE.coordinates()).reversed();

        List<Runnable> attempts =
                List.of(
                        () -> signer.verify(USER, token, GeoJsonLineString.of(moved), DISTANCE, PROFILE),
                        () -> signer.verify(USER, token, GeoJsonLineString.of(reversed), DISTANCE, PROFILE),
                        () -> signer.verify(USER, token, ROUTE, new BigDecimal("150.01"), PROFILE),
                        () -> signer.verify(USER, token, ROUTE, DISTANCE, regraded),
                        () -> signer.verify(USER, token, ROUTE, DISTANCE, PROFILE.subList(0, 1)),
                        () -> signer.verify(USER + 1, token, ROUTE, DISTANCE, PROFILE));
        for (Runnable attempt : attempts) {
            assertThat(invalid(attempt).errorCode()).isEqualTo(ErrorCode.COURSE_CANDIDATE_INVALID);
        }
    }

    @Test
    void 자릿수가_거대한_숫자는_문자열로_펼치지_않고_거절한다() {
        String token = signer.issue(USER, ROUTE, DISTANCE, PROFILE);
        long started = System.nanoTime();
        for (BigDecimal huge : List.of(new BigDecimal("1e999999999"), new BigDecimal("1e-999999999"))) {
            assertThat(invalid(() -> signer.verify(USER, token, ROUTE, huge, PROFILE)).errorCode())
                    .isEqualTo(ErrorCode.COURSE_CANDIDATE_INVALID);
        }
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(1));
    }

    @Test
    void 만료_시각부터는_거절한다() {
        String token = signer.issue(USER, ROUTE, DISTANCE, PROFILE);

        clock.advance(Duration.ofMinutes(30).minusSeconds(1));
        assertThatCode(() -> signer.verify(USER, token, ROUTE, DISTANCE, PROFILE))
                .doesNotThrowAnyException();
        clock.advance(Duration.ofSeconds(1));
        assertThat(invalid(() -> signer.verify(USER, token, ROUTE, DISTANCE, PROFILE)).errorCode())
                .isEqualTo(ErrorCode.COURSE_CANDIDATE_INVALID);
    }

    @Test
    void 형식이_깨지거나_만료를_바꾼_토큰은_거절한다() {
        String token = signer.issue(USER, ROUTE, DISTANCE, PROFILE);
        String[] parts = token.split("\\.");
        String laterExpiry = parts[0] + "." + (Long.parseLong(parts[1]) + 3600) + "." + parts[2];
        String flipped =
                parts[0] + "." + parts[1] + "." + (parts[2].charAt(0) == 'A' ? 'B' : 'A') + parts[2].substring(1);

        for (String bad :
                List.of(
                        "",
                        "v1",
                        "v2." + parts[1] + "." + parts[2],
                        parts[0] + ".0." + parts[2],
                        parts[0] + "." + parts[1] + "." + parts[2] + "=",
                        parts[0] + "." + parts[1] + ".short",
                        laterExpiry,
                        flipped)) {
            assertThat(invalid(() -> signer.verify(USER, bad, ROUTE, DISTANCE, PROFILE)).errorCode())
                    .as(bad)
                    .isEqualTo(ErrorCode.COURSE_CANDIDATE_INVALID);
        }
        assertThat(invalid(() -> signer.verify(USER, null, ROUTE, DISTANCE, PROFILE)).errorCode())
                .isEqualTo(ErrorCode.COURSE_CANDIDATE_INVALID);
    }

    @Test
    void JSON_표기_차이와_재직렬화에도_같은_값이면_통과한다() {
        String token = signer.issue(USER, ROUTE, DISTANCE, PROFILE);
        JsonMapper json = JsonMapper.builder().build();

        // 앱이 받은 응답을 다시 보내는 상황: 직렬화 → 파싱
        record Body(GeoJsonLineString route, BigDecimal distanceM, List<GradeSegment> elevationProfile) {}
        Body echoed =
                json.readValue(json.writeValueAsString(new Body(ROUTE, DISTANCE, PROFILE)), Body.class);
        assertThatCode(
                        () ->
                                signer.verify(
                                        USER,
                                        token,
                                        echoed.route(),
                                        echoed.distanceM(),
                                        echoed.elevationProfile()))
                .doesNotThrowAnyException();

        // JS가 다시 쓴 것 같은 표기(정수 거리, 0 떼기, 키 순서·공백 차이)
        Body jsStyle =
                json.readValue(
                        """
                        {"elevationProfile":[
                          {"gradePercent":0.8,"endDistanceM":100,"startDistanceM":0},
                          {"startDistanceM":100,"endDistanceM":150,"gradePercent":-1.25}],
                         "distanceM":150,
                         "route":{"type":"LineString","coordinates":[[129.0756,35.1796],[129.0761234567891,35.18],[129.077,35.1801]]}}
                        """,
                        Body.class);
        assertThatCode(
                        () ->
                                signer.verify(
                                        USER,
                                        token,
                                        jsStyle.route(),
                                        jsStyle.distanceM(),
                                        jsStyle.elevationProfile()))
                .doesNotThrowAnyException();
    }

    @Test
    void 키는_JWT_비밀값과_다른_용도별_파생키다() {
        byte[] secret = java.util.Base64.getDecoder().decode(TEST_SECRET);
        byte[] derived =
                CourseCandidateSigner.hkdf(
                        secret, CourseCandidateSigner.INFO.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(derived).hasSize(32).isNotEqualTo(secret);
        // RFC 5869 A.3(salt·info 없음) 테스트 벡터로 HKDF 구현을 고정한다(앞 32바이트).
        byte[] ikm = HexFormat.of().parseHex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b");
        assertThat(HexFormat.of().formatHex(CourseCandidateSigner.hkdf(ikm, new byte[0])))
                .isEqualTo("8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d");
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
