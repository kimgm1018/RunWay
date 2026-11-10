package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.session.entity.AnalysisSample;
import com.runway.backend.domain.session.entity.AnalysisSplit;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.SessionAnalysisStats;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseInterval;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseResumeEvent;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.Result;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 종료 후 분석(S15P31E105-312)의 순수 계산 규칙. DB 없이 합성 값만 쓴다. */
class PostRunAnalysisCalculatorTest {

    private static final Instant START = Instant.parse("2026-10-28T01:00:00Z");

    private static Instant at(long secondsFromStart) {
        return START.plusSeconds(secondsFromStart);
    }

    private static AnalysisSample sample(long sec, String distance, String hr, String cadence) {
        return new AnalysisSample(
                at(sec),
                distance == null ? null : new BigDecimal(distance),
                hr == null ? null : new BigDecimal(hr),
                cadence == null ? null : new BigDecimal(cadence));
    }

    private static AnalysisSample sample(long sec, String distance) {
        return sample(sec, distance, null, null);
    }

    private static PauseResumeEvent pause(long sec) {
        return new PauseResumeEvent(ControlAction.PAUSE, at(sec));
    }

    private static PauseResumeEvent resume(long sec) {
        return new PauseResumeEvent(ControlAction.RESUME, at(sec));
    }

    private static Result calculate(long endSec, List<AnalysisSample> samples, PauseResumeEvent... events) {
        return PostRunAnalysisCalculator.calculate(
                START, at(endSec), null, null, samples, List.of(events));
    }

    @Test
    void 구간_페이스는_구간_운동시간을_구간_킬로미터로_나눈_초_단위다() {
        Result result =
                calculate(
                        700,
                        List.of(
                                sample(0, "0"),
                                sample(150, "500"),
                                sample(300, "1000"),
                                sample(450, "1500"),
                                sample(600, "2000"),
                                sample(700, "2500")));

        assertThat(result.splits()).hasSize(3);
        assertThat(result.splits().get(0).pace()).isEqualByComparingTo("300");
        assertThat(result.splits().get(1).pace()).isEqualByComparingTo("300");
        // 마지막 500m 구간은 100초 → 200초/km
        AnalysisSplit tail = result.splits().get(2);
        assertThat(tail.startDistance()).isEqualByComparingTo("2000");
        assertThat(tail.endDistance()).isEqualByComparingTo("2500");
        assertThat(tail.pace()).isEqualByComparingTo("200");
        assertThat(result.stats().totalDistance()).isEqualByComparingTo("2500");
        assertThat(result.stats().averagePace()).isEqualByComparingTo("280");
    }

    @Test
    void 정확히_1km에서_끝나면_짧은_꼬리_구간을_만들지_않는다() {
        Result result = calculate(300, List.of(sample(0, "0"), sample(300, "1000")));

        assertThat(result.splits()).hasSize(1);
        assertThat(result.splits().get(0).startDistance()).isEqualByComparingTo("0");
        assertThat(result.splits().get(0).endDistance()).isEqualByComparingTo("1000");
        assertThat(result.splits().get(0).pace()).isEqualByComparingTo("300");
    }

    @Test
    void 일킬로미터_미만이면_구간은_하나이고_실제_거리까지다() {
        Result result = calculate(180, List.of(sample(0, "0"), sample(90, "300"), sample(180, "600")));

        assertThat(result.splits()).hasSize(1);
        assertThat(result.splits().get(0).endDistance()).isEqualByComparingTo("600");
        assertThat(result.splits().get(0).pace()).isEqualByComparingTo("300");
        assertThat(result.stats().totalDistance()).isEqualByComparingTo("600");
    }

    @Test
    void 구간_경계는_샘플_사이_선형_보간으로_구한다() {
        // 100초에 800m, 200초에 1200m → 1000m는 150초에 지난다.
        Result result =
                calculate(200, List.of(sample(0, "0"), sample(100, "800"), sample(200, "1200")));

        assertThat(result.splits()).hasSize(2);
        assertThat(result.splits().get(0).pace()).isEqualByComparingTo("150");
        // 남은 200m를 50초에 → 250초/km
        assertThat(result.splits().get(1).endDistance()).isEqualByComparingTo("1200");
        assertThat(result.splits().get(1).pace()).isEqualByComparingTo("250");
    }

    @Test
    void S02용_movingDurationSec는_시작전이면_null이다() {
        assertThat(PostRunAnalysisCalculator.movingDurationSec(null, at(100), List.of())).isNull();
        assertThat(PostRunAnalysisCalculator.movingDurationSec(START, null, List.of())).isNull();
    }

    @Test
    void S02용_movingDurationSec는_일시정지_없는_경과와_같다() {
        assertThat(PostRunAnalysisCalculator.movingDurationSec(START, at(600), List.of())).isEqualTo(600);
    }

    @Test
    void S02용_movingDurationSec는_열린_PAUSE를_기준시각까지_뺀다() {
        assertThat(
                        PostRunAnalysisCalculator.movingDurationSec(
                                START, at(500), List.of(pause(300))))
                .isEqualTo(300);
    }

    @Test
    void S02용_movingDurationSec는_재개_후와_여러_번_일시정지를_반영한다() {
        assertThat(
                        PostRunAnalysisCalculator.movingDurationSec(
                                START, at(700), List.of(pause(300), resume(400))))
                .isEqualTo(600);
        assertThat(
                        PostRunAnalysisCalculator.movingDurationSec(
                                START,
                                at(1000),
                                List.of(pause(100), resume(200), pause(500), resume(650))))
                .isEqualTo(750);
    }

    @Test
    void S02용_movingDurationSec는_종료_후_분석_movingDuration과_같다() {
        List<PauseResumeEvent> events = List.of(pause(300), resume(400));
        Result analyzed =
                PostRunAnalysisCalculator.calculate(
                        START, at(700), null, null, List.of(sample(0, "0"), sample(700, "2000")), events);

        assertThat(PostRunAnalysisCalculator.movingDurationSec(START, at(700), events))
                .isEqualTo(analyzed.stats().movingDuration());
    }

    @Test
    void 기준시각_이후의_열린_PAUSE는_운동시간에서_빼지_않는다() {
        // 기기 시계가 serverSendAt보다 앞선 APPLIED PAUSE(리뷰 B-2). pauseIntervals/addClamped와 동일.
        assertThat(
                        PostRunAnalysisCalculator.movingDurationSec(
                                START, at(600), List.of(pause(700))))
                .isEqualTo(600);
    }

    @Test
    void 일시정지는_운동시간과_구간_페이스에서_제외한다() {
        // 300~400초 일시정지. 500초에 1500m, 700초에 2000m.
        Result result =
                calculate(
                        700,
                        List.of(
                                sample(0, "0"),
                                sample(300, "1000"),
                                sample(400, "1000"),
                                sample(500, "1500"),
                                sample(700, "2000")),
                        pause(300),
                        resume(400));

        SessionAnalysisStats stats = result.stats();
        assertThat(stats.elapsedDuration()).isEqualTo(700);
        assertThat(stats.movingDuration()).isEqualTo(600);
        assertThat(stats.averagePace()).isEqualByComparingTo("300");
        // 일시정지 시간이 들어갔다면 두 번째 구간은 400초/km가 된다.
        assertThat(result.splits().get(1).pace()).isEqualByComparingTo("300");
    }

    @Test
    void 다시_시작하지_않고_종료하면_일시정지는_종료시각까지다() {
        Result result =
                calculate(
                        500, List.of(sample(0, "0"), sample(300, "1000")), pause(300));

        assertThat(result.stats().elapsedDuration()).isEqualTo(500);
        assertThat(result.stats().movingDuration()).isEqualTo(300);
        assertThat(result.stats().averagePace()).isEqualByComparingTo("300");
    }

    @Test
    void 중복_PAUSE와_짝없는_RESUME은_무시한다() {
        List<PauseInterval> intervals =
                PostRunAnalysisCalculator.pauseIntervals(
                        List.of(resume(50), pause(100), pause(150), resume(200), resume(250)),
                        START,
                        at(600));

        assertThat(intervals).containsExactly(new PauseInterval(at(100), at(200)));
    }

    @Test
    void 여러_번의_일시정지를_모두_뺀다() {
        Result result =
                calculate(
                        1000,
                        List.of(sample(0, "0"), sample(1000, "2000")),
                        pause(100),
                        resume(200),
                        pause(500),
                        resume(650));

        assertThat(result.stats().elapsedDuration()).isEqualTo(1000);
        assertThat(result.stats().movingDuration()).isEqualTo(750);
    }

    @Test
    void 시작_종료_범위_밖의_일시정지는_잘라서_계산한다() {
        List<PauseInterval> intervals =
                PostRunAnalysisCalculator.pauseIntervals(
                        List.of(pause(-30), resume(20), pause(580), resume(700)), START, at(600));

        assertThat(intervals)
                .containsExactly(new PauseInterval(START, at(20)), new PauseInterval(at(580), at(600)));
    }

    @Test
    void 총거리는_마지막_누적거리_샘플_값이다() {
        Result result =
                calculate(
                        300,
                        List.of(sample(0, "0"), sample(200, "800"), sample(300, "1000"), sample(310, null)));

        assertThat(result.stats().totalDistance()).isEqualByComparingTo("1000");
    }

    @Test
    void 샘플이_없으면_거리와_페이스는_null이고_구간도_없다() {
        Result result = calculate(600, List.of());

        SessionAnalysisStats stats = result.stats();
        assertThat(stats.totalDistance()).isNull();
        assertThat(stats.averagePace()).isNull();
        assertThat(stats.averageHeartRate()).isNull();
        assertThat(stats.averageCadence()).isNull();
        assertThat(stats.maxHeartRate()).isNull();
        // 시간은 시작·종료 시각만으로 계산할 수 있다.
        assertThat(stats.elapsedDuration()).isEqualTo(600);
        assertThat(stats.movingDuration()).isEqualTo(600);
        assertThat(result.splits()).isEmpty();
    }

    @Test
    void 거리가_계속_0이면_구간과_평균_페이스가_없다() {
        Result result = calculate(120, List.of(sample(0, "0"), sample(60, "0"), sample(120, "0")));

        assertThat(result.stats().totalDistance()).isEqualByComparingTo("0");
        assertThat(result.stats().averagePace()).isNull();
        assertThat(result.splits()).isEmpty();
    }

    @Test
    void 미측정_심박과_케이던스는_0이_아니라_null이다() {
        Result result =
                calculate(
                        600,
                        List.of(
                                sample(0, "0", null, null),
                                sample(300, "1000", null, null),
                                sample(600, "2000", null, null)));

        assertThat(result.stats().averageHeartRate()).isNull();
        assertThat(result.stats().averageCadence()).isNull();
        assertThat(result.stats().maxHeartRate()).isNull();
        assertThat(result.splits())
                .allSatisfy(
                        split -> {
                            assertThat(split.averageHeartRate()).isNull();
                            assertThat(split.averageCadence()).isNull();
                        });
    }

    @Test
    void 평균_심박과_케이던스는_측정된_샘플만으로_구하고_최대_심박을_기록한다() {
        // 심박 150, 미측정, 170 → 평균 160. 케이던스는 170 하나뿐.
        Result result =
                calculate(
                        300,
                        List.of(
                                sample(0, "0", "150", "170"),
                                sample(100, "300", null, null),
                                sample(300, "1000", "170", null)));

        assertThat(result.stats().averageHeartRate()).isEqualByComparingTo("160");
        assertThat(result.stats().maxHeartRate()).isEqualByComparingTo("170");
        assertThat(result.stats().averageCadence()).isEqualByComparingTo("170");
        assertThat(result.splits().get(0).averageHeartRate()).isEqualByComparingTo("160");
    }

    @Test
    void 구간_평균_심박은_그_구간에_속한_샘플만_쓴다() {
        // 1000m 경계 샘플은 앞 구간에 속한다.
        Result result =
                calculate(
                        600,
                        List.of(
                                sample(0, "0", "140", "160"),
                                sample(300, "1000", "160", "170"),
                                sample(450, "1500", "180", "180"),
                                sample(600, "2000", "200", "190")));

        assertThat(result.splits()).hasSize(2);
        assertThat(result.splits().get(0).averageHeartRate()).isEqualByComparingTo("150");
        assertThat(result.splits().get(0).averageCadence()).isEqualByComparingTo("165");
        assertThat(result.splits().get(1).averageHeartRate()).isEqualByComparingTo("190");
        assertThat(result.splits().get(1).averageCadence()).isEqualByComparingTo("185");
    }

    @Test
    void 목표_거리에_도달하면_도달_운동시간과_달성_여부를_계산한다() {
        List<AnalysisSample> samples =
                List.of(sample(0, "0"), sample(300, "1000"), sample(600, "2000"));

        Result achieved =
                PostRunAnalysisCalculator.calculate(START, at(600), 1000, 400, samples, List.of());
        assertThat(achieved.stats().movingDurationToGoal()).isEqualTo(300);
        assertThat(achieved.stats().goalAchieved()).isTrue();

        Result tooSlow =
                PostRunAnalysisCalculator.calculate(START, at(600), 1000, 250, samples, List.of());
        assertThat(tooSlow.stats().movingDurationToGoal()).isEqualTo(300);
        assertThat(tooSlow.stats().goalAchieved()).isFalse();
    }

    @Test
    void 목표_거리에_도달하지_못하면_도달시간은_null이고_미달성이다() {
        Result result =
                PostRunAnalysisCalculator.calculate(
                        START,
                        at(300),
                        5000,
                        null,
                        List.of(sample(0, "0"), sample(300, "1000")),
                        List.of());

        assertThat(result.stats().movingDurationToGoal()).isNull();
        assertThat(result.stats().goalAchieved()).isFalse();
    }

    @Test
    void 목표가_없으면_도달시간과_달성_여부는_null이다() {
        Result result = calculate(300, List.of(sample(0, "0"), sample(300, "1000")));

        assertThat(result.stats().movingDurationToGoal()).isNull();
        assertThat(result.stats().goalAchieved()).isNull();
    }

    @Test
    void 시작_종료_시각이_없거나_종료가_시작보다_늦지_않으면_예외다() {
        assertThatThrownBy(
                        () ->
                                PostRunAnalysisCalculator.calculate(
                                        null, at(10), null, null, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () ->
                                PostRunAnalysisCalculator.calculate(
                                        START, null, null, null, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(
                        () ->
                                PostRunAnalysisCalculator.calculate(
                                        START, START, null, null, List.of(), List.of()))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
