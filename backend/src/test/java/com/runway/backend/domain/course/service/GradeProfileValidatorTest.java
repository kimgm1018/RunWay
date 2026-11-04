package com.runway.backend.domain.course.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class GradeProfileValidatorTest {

    private static final BigDecimal DISTANCE = new BigDecimal("2450.50");

    private static GradeSegment seg(String start, String end, String grade) {
        return new GradeSegment(
                new BigDecimal(start),
                new BigDecimal(end),
                grade == null ? null : new BigDecimal(grade));
    }

    /** 0부터 step 간격으로 distance까지 나눈 목록(마지막은 남은 거리), 경사는 모두 grade. */
    static List<GradeSegment> uniform(String distance, int step, String grade) {
        BigDecimal d = new BigDecimal(distance);
        BigDecimal s = BigDecimal.valueOf(step);
        List<GradeSegment> result = new ArrayList<>();
        for (BigDecimal start = BigDecimal.ZERO; start.compareTo(d) < 0; start = start.add(s)) {
            BigDecimal end = start.add(s).min(d);
            result.add(new GradeSegment(start, end, new BigDecimal(grade)));
        }
        return result;
    }

    private static List<GradeSegment> replace(List<GradeSegment> base, int i, GradeSegment s) {
        List<GradeSegment> copy = new ArrayList<>(base);
        copy.set(i, s);
        return copy;
    }

    private static void assertRejected(List<GradeSegment> profile, BigDecimal distance) {
        assertThatThrownBy(() -> GradeProfileValidator.validate(profile, distance))
                .isInstanceOf(ApiException.class)
                .extracting("errorCode")
                .isEqualTo(ErrorCode.VALIDATION_ERROR);
    }

    private static void assertRejected(List<GradeSegment> profile) {
        assertRejected(profile, DISTANCE);
    }

    private static void assertAccepted(List<GradeSegment> profile, BigDecimal distance) {
        assertThatCode(() -> GradeProfileValidator.validate(profile, distance))
                .doesNotThrowAnyException();
    }

    @Test
    void 거절은_공통_VALIDATION_ERROR이며_필드이름과_사유만_담는다() {
        List<GradeSegment> profile =
                replace(uniform("2450.5", 100, "1.5"), 3, seg("300", "400", "100.5"));
        assertThatThrownBy(() -> GradeProfileValidator.validate(profile, DISTANCE))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> {
                            assertThat(e.errorCode()).isEqualTo(ErrorCode.VALIDATION_ERROR);
                            assertThat(e.status().value()).isEqualTo(400);
                            assertThat(e.details())
                                    .isEqualTo(
                                            Map.of(
                                                    "fields",
                                                    List.of(
                                                            Map.of(
                                                                    "name",
                                                                    "elevationProfile[3].gradePercent",
                                                                    "reason",
                                                                    "-100~100 범위여야 합니다."))));
                        });
    }

    @Test
    void 정상_100m조각_마지막조각_짧음_허용() {
        List<GradeSegment> profile = uniform("2450.5", 100, "1.5");
        assertThat(profile).hasSize(25);
        assertThat(profile.get(24).endDistanceM()).isEqualByComparingTo("2450.5");
        assertAccepted(profile, DISTANCE);
    }

    @Test
    void 경계_단일조각_및_마지막조각_정확히100m() {
        assertAccepted(List.of(seg("0", "80", "0")), new BigDecimal("80.00"));
        assertAccepted(uniform("2000", 100, "0"), new BigDecimal("2000.00"));
    }

    @Test
    void 경계_총거리_099m이내_허용_정확히1m부터_거절() {
        // AI는 float로 ≤ 1.0을 검사해 정확히 1m는 오차로 거절될 수 있으므로 서버는 0.99m까지만 받는다(A3-1·B3-2)
        assertAccepted(uniform("2450.5", 100, "0"), new BigDecimal("2451.49"));
        assertAccepted(uniform("2450.5", 100, "0"), new BigDecimal("2449.51"));
        assertAccepted(uniform("2000", 100, "0"), new BigDecimal("2000.50"));
        assertRejected(uniform("2450.5", 100, "0"), new BigDecimal("2451.50"));
        assertRejected(uniform("2450.5", 100, "0"), new BigDecimal("2449.50"));
        assertRejected(uniform("2450.5", 100, "0"), new BigDecimal("2452.00"));
    }

    @ParameterizedTest
    @CsvSource({
        "45000.00, 100",
        "44999.99, 100",
        "45000.01, 200",
        "90000.00, 200",
        "90000.01, 300",
        "100.00, 100",
        "0.01, 100"
    })
    void 조각폭은_100m_450개초과면_AI와같이_확대(String distance, int expected) {
        assertThat(GradeProfileValidator.stepFor(new BigDecimal(distance)))
                .isEqualByComparingTo(BigDecimal.valueOf(expected));
    }

    @Test
    void 장거리_코스는_확대된_폭만_허용() {
        // 50km: ceil(500) > 450 → 200m 폭, 250조각
        assertAccepted(uniform("50000", 200, "0"), new BigDecimal("50000.00"));
        assertRejected(uniform("50000", 100, "0"), new BigDecimal("50000.00"));
        // 마라톤 42.195km: 100m, 422조각
        List<GradeSegment> marathon = uniform("42195", 100, "0.2");
        assertThat(marathon).hasSize(422);
        assertAccepted(marathon, new BigDecimal("42195.00"));
    }

    @Test
    void 조각수_450초과_거절() {
        List<GradeSegment> tooMany = new ArrayList<>(uniform("45000", 100, "0"));
        tooMany.add(seg("45000", "45000.5", "0"));
        assertThat(tooMany).hasSize(451);
        // 45000.00이면 폭 100m, 451번째 조각도 격자·폭·총거리(0.5m)를 모두 만족해 개수 규칙만으로 거절된다(A3-2)
        assertRejected(tooMany, new BigDecimal("45000.00"));
        assertAccepted(tooMany.subList(0, 450), new BigDecimal("45000.00"));
    }

    @Test
    void 시작이_0이_아니거나_격자에서_벗어나면_거절() {
        assertRejected(List.of(seg("0.5", "80", "0")), new BigDecimal("80.00"));
        // 모든 조각을 5m 밀어 연속·폭·총거리(±1m 아님)를 맞추고 격자 규칙만 깨지게 함
        List<GradeSegment> shifted = new ArrayList<>();
        for (GradeSegment s : uniform("2000", 100, "0")) {
            shifted.add(
                    new GradeSegment(
                            s.startDistanceM().add(BigDecimal.valueOf(5)),
                            s.endDistanceM().add(BigDecimal.valueOf(5)),
                            s.gradePercent()));
        }
        assertRejected(shifted, new BigDecimal("2005.00"));
    }

    @Test
    void 격자에서_1e6만_벗어나도_거절_AI_float경계_차단() {
        // 서버가 받은 값은 AI float 검사도 통과해야 하므로 시작·폭은 정확히 일치해야 한다(리뷰 A3-1·B3-1)
        assertRejected(
                List.of(seg("0", "100.000001", "0"), seg("100.000001", "200", "0")),
                new BigDecimal("200.00"));
        assertRejected(
                List.of(seg("0", "100", "0"), seg("100.000001", "200", "0")),
                new BigDecimal("200.00"));
        assertRejected(List.of(seg("0.000001", "80", "0")), new BigDecimal("80.00"));
    }

    @Test
    void 조각사이_틈_겹침_중간폭_거절() {
        List<GradeSegment> base = uniform("2450.5", 100, "0");
        assertRejected(replace(base, 3, seg("300", "399", "0")));
        assertRejected(replace(base, 4, seg("390", "500", "0")));
        assertRejected(
                List.of(seg("0", "90", "0"), seg("90", "200", "0")), new BigDecimal("200.00"));
    }

    @Test
    void 마지막조각_폭0_또는_100m초과_거절() {
        List<GradeSegment> zeroTail = new ArrayList<>(uniform("2000", 100, "0"));
        zeroTail.add(seg("2000", "2000", "0"));
        assertRejected(zeroTail, new BigDecimal("2000.00"));
        assertRejected(
                List.of(seg("0", "100", "0"), seg("100", "250", "0")), new BigDecimal("250.00"));
    }

    @Test
    void 순서_뒤바뀜_거절() {
        List<GradeSegment> base = new ArrayList<>(uniform("2450.5", 100, "0"));
        GradeSegment first = base.get(0);
        base.set(0, base.get(1));
        base.set(1, first);
        assertRejected(base);
    }

    @Test
    void 빈목록_null_필수누락_거절() {
        assertRejected(List.of());
        assertRejected(null);
        assertRejected(Arrays.asList(seg("0", "100", "0"), null), new BigDecimal("200.00"));
        assertRejected(List.of(seg("0", "80", null)), new BigDecimal("80.00"));
        assertRejected(
                List.of(new GradeSegment(null, new BigDecimal("80"), BigDecimal.ZERO)),
                new BigDecimal("80.00"));
        assertRejected(
                List.of(new GradeSegment(BigDecimal.ZERO, null, BigDecimal.ZERO)),
                new BigDecimal("80.00"));
    }

    @Test
    void 경사_경계값_허용() {
        for (String g : List.of("-100", "100", "0", "99.999999", "-0.000001")) {
            assertAccepted(List.of(seg("0", "80", g)), new BigDecimal("80.00"));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"-100.000001", "100.01", "1E+1000", "1E+13"})
    void 경사_범위밖_거절(String value) {
        assertRejected(List.of(seg("0", "80", value)), new BigDecimal("80.00"));
    }

    @Test
    void 소수6자리초과_거절_끝자리0은_허용() {
        assertRejected(List.of(seg("0", "80", "1.1234567")), new BigDecimal("80.00"));
        assertRejected(List.of(seg("0", "80", "1E-20000")), new BigDecimal("80.00"));
        assertRejected(List.of(seg("0", "80.0000001", "0")), new BigDecimal("80.00"));
        assertAccepted(List.of(seg("0", "80", "1.1000000000")), new BigDecimal("80.00"));
    }

    @Test
    void 정규화된_값을_반환() {
        List<GradeSegment> normalized =
                GradeProfileValidator.validate(
                        List.of(
                                new GradeSegment(
                                        new BigDecimal("0E-2000"),
                                        new BigDecimal("1E+2"),
                                        new BigDecimal("1.1000")),
                                new GradeSegment(
                                        new BigDecimal("100.00"),
                                        new BigDecimal("150"),
                                        new BigDecimal("0E-999"))),
                        new BigDecimal("150.00"));
        assertThat(normalized.get(0).startDistanceM().toString()).isEqualTo("0");
        assertThat(normalized.get(0).endDistanceM().toString()).isEqualTo("100");
        assertThat(normalized.get(0).gradePercent().toString()).isEqualTo("1.1");
        assertThat(normalized.get(1).startDistanceM().toString()).isEqualTo("100");
        assertThat(normalized.get(1).gradePercent().toString()).isEqualTo("0");
    }

    @ParameterizedTest
    @ValueSource(strings = {"100E+2147483647", "-100E+2147483647", "1E+100000000"})
    void 지수가_극단적인_값은_빠르게_도메인예외로_거절(String value) {
        BigDecimal v = new BigDecimal(value);
        assertTimeoutPreemptively(
                Duration.ofSeconds(2),
                () -> {
                    assertRejected(List.of(seg("0", "80", value)), new BigDecimal("80.00"));
                    assertRejected(
                            List.of(new GradeSegment(BigDecimal.ZERO, v, BigDecimal.ZERO)),
                            new BigDecimal("80.00"));
                    assertRejected(
                            List.of(new GradeSegment(v, v, BigDecimal.ZERO)),
                            new BigDecimal("80.00"));
                    assertRejected(uniform("2450.5", 100, "0"), v);
                });
    }

    @Test
    void 영값의_극단적_스케일은_빠르게_0으로_정규화() {
        assertTimeoutPreemptively(
                Duration.ofSeconds(2),
                () -> {
                    List<GradeSegment> normalized =
                            GradeProfileValidator.validate(
                                    List.of(
                                            new GradeSegment(
                                                    new BigDecimal("0E-100000000"),
                                                    new BigDecimal("80"),
                                                    new BigDecimal("0E-100000000"))),
                                    new BigDecimal("80.00"));
                    assertThat(normalized.get(0).startDistanceM().toString()).isEqualTo("0");
                    assertThat(normalized.get(0).gradePercent().toString()).isEqualTo("0");
                });
    }

    @Test
    void 코스거리_범위밖_거절() {
        assertRejected(uniform("80", 100, "0"), BigDecimal.ZERO);
        assertRejected(uniform("80", 100, "0"), null);
        assertRejected(uniform("80", 100, "0"), new BigDecimal("10000000000"));
    }
}
