package com.runway.backend.domain.readiness.trainingload;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.readiness.trainingload.TrainingLoadCalculator.Result;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadCalculator.Sample;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.SortedMap;
import org.junit.jupiter.api.Test;

/**
 * 599 AC-1. 기대값은 플랜 3.1 규칙으로 손계산한 값이다. HRmax 190·RHR 60 → HRR 130, Zone 경계 Z1 125~138, Z2 138~151, Z3 151~164,
 * Z4 164~177, Z5 177~190(bpm). 모든 심박 값은 합성 데이터다.
 */
class TrainingLoadCalculatorTest {

    private static final Instant T0 = Instant.parse("2026-11-01T00:00:00Z");

    private static Sample at(long seconds, double bpm) {
        return new Sample(T0.plusSeconds(seconds), bpm);
    }

    private static Sample atMillis(long millis, double bpm) {
        return new Sample(T0.plusMillis(millis), bpm);
    }

    @Test
    void 샘플_간격만큼_bpm에_머문_초를_세고_마지막_샘플은_0초다() {
        SortedMap<Integer, Integer> histogram =
                TrainingLoadCalculator.histogram(
                        List.of(at(0, 130), at(5, 140), at(10, 155), at(15, 170), at(20, 185)));

        assertThat(histogram).containsExactly(
                Map.entry(130, 5), Map.entry(140, 5), Map.entry(155, 5), Map.entry(170, 5));
    }

    @Test
    void 간격이_60초를_넘으면_60초만_센다() {
        assertThat(TrainingLoadCalculator.histogram(List.of(at(0, 140), at(120, 141))))
                .containsExactly(Map.entry(140, 60));
    }

    @Test
    void 같은_시각의_두번째_샘플과_범위_밖_심박은_버린다() {
        SortedMap<Integer, Integer> histogram =
                TrainingLoadCalculator.histogram(
                        List.of(
                                at(0, 140),
                                at(0, 200),
                                at(5, 29.9),
                                at(10, 220.1),
                                at(10, Double.NaN),
                                at(10, 150),
                                at(15, 150)));

        // 140은 0→10초(29.9·220.1·NaN 샘플은 없는 것으로 봄), 150은 10→15초.
        assertThat(histogram).containsExactly(Map.entry(140, 10), Map.entry(150, 5));
    }

    @Test
    void bpm은_반올림하고_밀리초_합을_초로_반올림한다() {
        SortedMap<Integer, Integer> histogram =
                TrainingLoadCalculator.histogram(
                        List.of(
                                atMillis(0, 139.5),
                                atMillis(1_499, 139.4),
                                atMillis(2_998, 150.0),
                                atMillis(3_498, 160.0)));

        // 140: 1.499초 → 1, 139: 1.499초 → 1, 150: 0.5초 → 1(HALF_UP), 160: 마지막 0초는 없음.
        assertThat(histogram).containsExactly(Map.entry(139, 1), Map.entry(140, 1), Map.entry(150, 1));
    }

    @Test
    void Zone별_초와_TRIMP를_계산한다() {
        Result result =
                TrainingLoadCalculator.calculate(
                        Map.of(130, 600, 140, 1200, 155, 900, 170, 300, 185, 60, 100, 999),
                        190,
                        60);

        // 100bpm은 Zone1 미만이라 세지 않는다. (600·1 + 1200·2 + 900·3 + 300·4 + 60·5) / 60 = 7200 / 60 = 120
        assertThat(result.zoneSeconds()).containsExactly(600, 1200, 900, 300, 60);
        assertThat(result.trainingLoad()).isEqualByComparingTo("120.0000");
    }

    @Test
    void 부하는_소수_넷째_자리로_반올림한다() {
        // 5·1 + 5·2 + 5·3 + 5·4 = 50 → 50/60 = 0.83333…
        Result result =
                TrainingLoadCalculator.calculate(Map.of(130, 5, 140, 5, 155, 5, 170, 5), 190, 60);

        assertThat(result.trainingLoad()).isEqualByComparingTo("0.8333");
        assertThat(result.trainingLoad().scale()).isEqualTo(4);
    }

    @Test
    void RHR이_0이면_HRmax_비율로_나눈다() {
        // HRmax 200: Z1 100~120, Z2 120~140, Z3 140~160, Z4 160~180, Z5 180~200
        Result result = TrainingLoadCalculator.calculate(Map.of(110, 60, 150, 60, 199, 60), 200, 0);

        assertThat(result.zoneSeconds()).containsExactly(60, 0, 60, 0, 60);
        assertThat(result.trainingLoad()).isEqualByComparingTo("9");
    }

    @Test
    void 여유_심박이_0_이하이면_모든_Zone이_0이다() {
        Result result = TrainingLoadCalculator.calculate(Map.of(150, 600), 150, 150);

        assertThat(result.zoneSeconds()).containsExactly(0, 0, 0, 0, 0);
        assertThat(result.trainingLoad()).isEqualByComparingTo("0");
    }

    @Test
    void 샘플이_없거나_하나뿐이면_빈_히스토그램() {
        assertThat(TrainingLoadCalculator.histogram(List.of())).isEmpty();
        assertThat(TrainingLoadCalculator.histogram(List.of(at(0, 140)))).isEmpty();
    }
}
