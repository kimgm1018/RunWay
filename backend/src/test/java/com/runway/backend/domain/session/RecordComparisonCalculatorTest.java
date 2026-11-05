package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.entity.AnalysisSample;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseResumeEvent;
import com.runway.backend.domain.session.service.RecordComparisonCalculator;
import com.runway.backend.domain.session.service.RecordComparisonCalculator.Gap;
import com.runway.backend.domain.session.service.RecordComparisonCalculator.Track;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 기록 비교(S15P31E105-422, sessions.md "기록 비교")의 순수 계산 규칙. 합성 값만 쓴다. */
class RecordComparisonCalculatorTest {

    private static final Instant START = Instant.parse("2026-10-28T01:00:00Z");

    private static Instant at(long sec) {
        return START.plusSeconds(sec);
    }

    private static AnalysisSample sample(long sec, String distance) {
        return new AnalysisSample(
                at(sec), distance == null ? null : new BigDecimal(distance), null, null);
    }

    private static PauseResumeEvent pause(long sec) {
        return new PauseResumeEvent(ControlAction.PAUSE, at(sec));
    }

    private static PauseResumeEvent resume(long sec) {
        return new PauseResumeEvent(ControlAction.RESUME, at(sec));
    }

    private static Track track(long untilSec, List<AnalysisSample> samples, PauseResumeEvent... events) {
        return RecordComparisonCalculator.track(START, at(untilSec), samples, List.of(events));
    }

    /** 0~1km 300초, 1~2km 400초. 평균 페이스 근사(350초/km)와 다르다. */
    private static Track unevenPast() {
        return track(700, List.of(sample(0, "0"), sample(300, "1000"), sample(700, "2000")));
    }

    @Test
    void 비균일_페이스_기록은_평균_근사가_아니라_같은_거리_도달_운동시간과_비교한다() {
        Track current = track(280, List.of(sample(0, "0"), sample(280, "1000")));

        Gap gap = RecordComparisonCalculator.compare(current, unevenPast());

        // 평균 근사라면 700 × 1000 / 2000 = 350초와 비교했을 것이다.
        assertThat(gap).isEqualTo(new Gap(1000, 280, 300));
    }

    @Test
    void 과거_기록은_앞뒤_샘플_사이를_선형_보간한다() {
        Track current = track(520, List.of(sample(0, "0"), sample(520, "1500")));

        Gap gap = RecordComparisonCalculator.compare(current, unevenPast());

        assertThat(gap).isEqualTo(new Gap(1500, 520, 500));
    }

    @Test
    void 양쪽_일시정지_구간은_운동시간에서_뺀다() {
        // 과거: 200~260초 일시정지(60초) → 1000m 운동시간 300초
        Track past =
                track(
                        400,
                        List.of(sample(0, "0"), sample(150, "500"), sample(360, "1000")),
                        pause(200),
                        resume(260));
        // 현재: 150~180초 일시정지(30초) → 1000m 운동시간 280초
        Track current =
                track(
                        310,
                        List.of(sample(0, "0"), sample(130, "500"), sample(310, "1000")),
                        pause(150),
                        resume(180));

        assertThat(RecordComparisonCalculator.compare(current, past))
                .isEqualTo(new Gap(1000, 280, 300));
    }

    @Test
    void 열린_일시정지는_계산_시각까지_빼고_현재_시간은_마지막_거리_샘플_시각_기준이다() {
        // 100초에 PAUSE 후 RESUME 없음. 마지막 거리 샘플은 150초(정지 중)이므로 운동시간 100초.
        Track current =
                track(200, List.of(sample(0, "0"), sample(100, "400"), sample(150, "400")), pause(100));

        Gap gap = RecordComparisonCalculator.compare(current, unevenPast());

        assertThat(gap).isEqualTo(new Gap(400, 100, 120));
    }

    @Test
    void 현재_거리가_과거_총거리를_넘으면_과거_총거리에서_비교한다() {
        Track current =
                track(650, List.of(sample(0, "0"), sample(600, "2000"), sample(650, "2200")));

        Gap gap = RecordComparisonCalculator.compare(current, unevenPast());

        assertThat(gap).isEqualTo(new Gap(2000, 600, 700));
    }

    @Test
    void 현재_거리가_없으면_비교하지_않는다() {
        Track none = track(30, List.of());
        Track zero = track(30, List.of(sample(0, "0"), sample(20, null)));

        assertThat(RecordComparisonCalculator.compare(none, unevenPast())).isNull();
        assertThat(RecordComparisonCalculator.compare(zero, unevenPast())).isNull();
    }

    @Test
    void 과거_기록에_거리가_없으면_곡선_거리는_0이다() {
        Track past = track(700, List.of(sample(0, null), sample(300, null)));
        Track current = track(280, List.of(sample(0, "0"), sample(280, "1000")));

        assertThat(past.distance()).isZero();
        assertThat(RecordComparisonCalculator.compare(current, past)).isNull();
    }

    @Test
    void 거리_소수점은_버리고_시간은_반올림한다() {
        Track current = track(281, List.of(sample(0, "0"), sample(281, "999.9")));

        Gap gap = RecordComparisonCalculator.compare(current, unevenPast());

        // 과거 999.9m 도달 = 299.97초 → 300
        assertThat(gap).isEqualTo(new Gap(999, 281, 300));
    }
}
