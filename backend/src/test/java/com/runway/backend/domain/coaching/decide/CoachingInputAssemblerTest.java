package com.runway.backend.domain.coaching.decide;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.coaching.decide.CoachingInputAssembler.Skip;
import com.runway.backend.domain.coaching.decide.CoachingSource.AppliedCoaching;
import com.runway.backend.domain.coaching.decide.CoachingSource.GradeSegment;
import com.runway.backend.domain.coaching.decide.CoachingSource.Plan;
import com.runway.backend.domain.coaching.decide.CoachingSource.PlanSegment;
import com.runway.backend.domain.coaching.decide.CoachingSource.Sample;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** AI04 입력 조립 — 421 플랜 AC-2·AC-3(T-3·T-4·T-5·T-6). 모든 값은 합성 데이터다. */
class CoachingInputAssemblerTest {

    private static final Instant NOW = Instant.parse("2026-11-05T03:00:00Z");
    private static final Instant STARTED = NOW.minusSeconds(600);

    /** t0 경과 300초, 1초마다 표본 60개(심박 150, 속도 2.5). */
    private static List<Sample> steadySamples() {
        List<Sample> samples = new ArrayList<>();
        for (int i = 59; i >= 0; i--) {
            samples.add(sample(300 - i, NOW.minusSeconds(i + 2L), 150.0, 2.5, 750.0 - i * 2.5));
        }
        return samples;
    }

    private static Sample sample(int elapsed, Instant at, Double hr, Double speed, Double distance) {
        return new Sample(elapsed, at, hr, speed, null, distance, null);
    }

    private static CoachingSource source(List<Sample> samples) {
        return new CoachingSource(
                7L, 3L, 4L, STARTED, null, null, null, null, null, null, null, null, samples);
    }

    private static CoachingSource withGoalAndPlan(Plan plan, AppliedCoaching applied) {
        return new CoachingSource(
                7L, 3L, 4L, STARTED, 5000, null, new BigDecimal("330.00"), null, null, plan,
                applied, null, steadySamples());
    }

    private static PaceDecideRequest request(CoachingSource source) {
        return CoachingInputAssembler.assemble(source, NOW).assembled().request();
    }

    @Test
    void history는_5초_칸의_마지막_값이며_마지막_칸이_t0다() {
        List<Sample> samples = new ArrayList<>();
        samples.add(sample(10, NOW.minusSeconds(12), 140.0, 2.0, 20.0));
        samples.add(sample(12, NOW.minusSeconds(10), 142.0, null, 25.0));
        // 15~19초 칸은 측정이 없다.
        samples.add(sample(21, NOW.minusSeconds(1), 150.0, 2.6, 50.0));

        PaceDecideRequest.History history = request(source(samples)).history();

        // 0~4, 5~9, 10~14, 15~19, 20~24초 칸 = 5칸
        assertThat(history.hrBpm()).containsExactly(null, null, 142.0, null, 150.0);
        assertThat(history.speedMps()).containsExactly(null, null, 2.0, null, 2.6);
        assertThat(history.gradePct()).containsOnlyNulls().hasSize(5);
    }

    @Test
    void history는_최근_360칸만_보낸다() {
        List<Sample> samples = new ArrayList<>();
        for (int e = 0; e <= 4000; e += 5) {
            samples.add(sample(e, NOW.minusSeconds((4000 - e) / 100 + 1), 150.0, 2.5, e * 2.5));
        }

        PaceDecideRequest.History history = request(source(samples)).history();

        assertThat(history.hrBpm()).hasSize(CoachingInputAssembler.HISTORY_CELLS);
        assertThat(history.speedMps()).hasSize(CoachingInputAssembler.HISTORY_CELLS);
    }

    @Test
    void 후보는_기준_페이스_대비_순서대로_5개이고_24칸_속도를_가진다() {
        PaceDecideRequest request = request(source(steadySamples()));

        // 실측 평균 2.5m/s = 400초/km
        assertThat(request.context().anchorPaceSecPerKm()).isEqualByComparingTo("400.00");
        assertThat(request.candidates())
                .extracting(c -> c.paceSecPerKm().toPlainString())
                .containsExactly("390.00", "395.00", "400.00", "405.00", "410.00");
        PaceDecideRequest.Candidate first = request.candidates().get(0);
        assertThat(first.futureSpeedMps()).hasSize(24).containsOnly(1000.0 / 390.0);
        assertThat(first.futureGradePct()).isNull();
    }

    @Test
    void context는_계약_필드를_채운다() {
        CoachingSource source =
                new CoachingSource(
                        7L, 3L, 4L, STARTED, 5000, 1800, null, null, null, null,
                        new AppliedCoaching(11L, NOW.minusSeconds(90), new BigDecimal("355.50"), null),
                        NOW.minusSeconds(200), steadySamples());

        var assembled = CoachingInputAssembler.assemble(source, NOW).assembled();
        PaceDecideRequest request = assembled.request();
        PaceDecideRequest.Context context = request.context();

        assertThat(request.elapsedSec()).isEqualTo(300);
        assertThat(request.userId()).isEqualTo(3L);
        assertThat(request.sessionStartedAt()).isEqualTo(STARTED);
        assertThat(request.includeForecast()).isFalse();
        assertThat(context.sessionId()).isEqualTo(7L);
        assertThat(context.stateVersion()).isEqualTo(4L);
        assertThat(context.runState()).isEqualTo("RUNNING");
        assertThat(context.mode()).isEqualTo("FREE_WITH_GOAL");
        assertThat(context.goal()).isEqualTo(new PaceDecideRequest.Goal(5000, 1800, null));
        assertThat(context.goalPreference()).isEqualByComparingTo("0.5");
        assertThat(context.activeSec()).isEqualTo(300);
        assertThat(context.distanceM()).isEqualTo(750.0);
        assertThat(context.routeProgressM()).isNull();
        // 마지막 적용 코칭이 현재 안내 페이스다.
        assertThat(context.anchorPaceSecPerKm()).isEqualByComparingTo("355.50");
        assertThat(context.currentGuidePaceSecPerKm()).isEqualByComparingTo("355.50");
        assertThat(context.lastCoaching()).isEqualTo(new PaceDecideRequest.LastCoaching(11L, NOW.minusSeconds(90)));
        assertThat(context.resumedAt()).isEqualTo(NOW.minusSeconds(200));
        // 심박·속도 모두 마지막 표본이 2초 전이다.
        assertThat(context.inputAsOf()).isEqualTo(NOW.minusSeconds(2));
        assertThat(assembled.inputAsOf()).isEqualTo(NOW.minusSeconds(2));
    }

    @Test
    void 기준_페이스는_적용_코칭_계획_구간_계획_목표_실측_순으로_정한다() {
        Plan plan =
                new Plan(
                        new BigDecimal("340.00"),
                        List.of(
                                new PlanSegment(new BigDecimal("0"), new BigDecimal("500"), new BigDecimal("350.00")),
                                new PlanSegment(new BigDecimal("500"), new BigDecimal("1000"), new BigDecimal("332.00"))));
        AppliedCoaching applied =
                new AppliedCoaching(1L, NOW.minusSeconds(60), new BigDecimal("345.25"), null);

        assertThat(request(withGoalAndPlan(plan, applied)).context().anchorPaceSecPerKm())
                .isEqualByComparingTo("345.25");
        // 거리 750m는 두 번째 계획 구간이다.
        assertThat(request(withGoalAndPlan(plan, null)).context().anchorPaceSecPerKm())
                .isEqualByComparingTo("332.00");
        Plan noSegments = new Plan(new BigDecimal("340.00"), List.of());
        assertThat(request(withGoalAndPlan(noSegments, null)).context().anchorPaceSecPerKm())
                .isEqualByComparingTo("340.00");
        assertThat(request(withGoalAndPlan(null, null)).context().anchorPaceSecPerKm())
                .isEqualByComparingTo("330.00");
    }

    @Test
    void 계획_구간_비율은_구간_페이스를_계획_추천_페이스로_나눈_값이다() {
        Plan plan =
                new Plan(
                        new BigDecimal("400.00"),
                        List.of(
                                new PlanSegment(new BigDecimal("0"), new BigDecimal("500"), new BigDecimal("420.00")),
                                new PlanSegment(new BigDecimal("500"), new BigDecimal("1000"), new BigDecimal("380.00"))));

        assertThat(request(withGoalAndPlan(plan, null)).context().plan())
                .containsExactly(
                        new PaceDecideRequest.PlanSegment(0, 500, 1.05),
                        new PaceDecideRequest.PlanSegment(500, 1000, 0.95));
    }

    @Test
    void mode는_코스_목표_무목표로_나눈다() {
        CoachingSource course =
                new CoachingSource(
                        7L, 3L, 4L, STARTED, null, null, null, new BigDecimal("3000"), null, null,
                        null, null, steadySamples());

        assertThat(request(course).context().mode()).isEqualTo("COURSE");
        assertThat(request(withGoalAndPlan(null, null)).context().mode()).isEqualTo("FREE_WITH_GOAL");
        assertThat(request(source(steadySamples())).context().mode()).isEqualTo("FREE_NO_GOAL");
    }

    @Test
    void 코스는_누적거리_진행위치에서_100m_경사를_24칸에_매핑한다() {
        List<GradeSegment> profile = new ArrayList<>();
        for (int start = 0; start < 3000; start += 100) {
            profile.add(new GradeSegment(start, start + 100, start / 100.0));
        }
        CoachingSource course =
                new CoachingSource(
                        7L, 3L, 4L, STARTED, null, null, null, new BigDecimal("3000"), profile, null,
                        null, null, steadySamples());

        PaceDecideRequest request = request(course);

        // 진행거리는 누적거리 750m. 기준 페이스 후보(400초/km)는 2.5m/s로 5초마다 12.5m 간다.
        assertThat(request.context().routeProgressM()).isEqualTo(750.0);
        List<Double> grade = request.candidates().get(2).futureGradePct();
        assertThat(grade).hasSize(24);
        assertThat(grade.get(0)).isEqualTo(7.0); // 762.5m
        assertThat(grade.get(23)).isEqualTo(10.0); // 1050m
    }

    @Test
    void 코스_끝을_넘거나_경사가_없으면_미래_경사는_null이다() {
        List<GradeSegment> shortProfile = List.of(new GradeSegment(0, 800, 1.0));
        CoachingSource beyond =
                new CoachingSource(
                        7L, 3L, 4L, STARTED, null, null, null, new BigDecimal("800"), shortProfile,
                        null, null, null, steadySamples());
        CoachingSource noProfile =
                new CoachingSource(
                        7L, 3L, 4L, STARTED, null, null, null, new BigDecimal("3000"), null, null,
                        null, null, steadySamples());

        assertThat(request(beyond).candidates()).allSatisfy(c -> assertThat(c.futureGradePct()).isNull());
        assertThat(request(noProfile).candidates()).allSatisfy(c -> assertThat(c.futureGradePct()).isNull());
    }

    @Test
    void 코스_마지막_조각의_끝_지점은_경사를_가진다() {
        List<GradeSegment> profile = List.of(new GradeSegment(0, 100, 1.0), new GradeSegment(100, 150.5, 2.0));

        assertThat(CoachingInputAssembler.gradeAt(profile, 150.5)).isEqualTo(2.0);
        assertThat(CoachingInputAssembler.gradeAt(profile, 150.6)).isNull();
        assertThat(CoachingInputAssembler.gradeAt(profile, 100)).isEqualTo(2.0);
    }

    @Test
    void t0_심박이_없으면_만들지_않는다() {
        List<Sample> samples = new ArrayList<>(steadySamples());
        // 305~309초 칸(t0)에는 심박 측정이 없다.
        samples.add(sample(306, NOW.minusSeconds(1), null, 2.5, 760.0));

        assertThat(CoachingInputAssembler.assemble(source(samples), NOW).skip())
                .isEqualTo(Skip.INPUT_INSUFFICIENT);
    }

    @Test
    void 표본이_없거나_속도가_없으면_만들지_않는다() {
        List<Sample> hrOnly = List.of(sample(10, NOW.minusSeconds(1), 150.0, null, null));

        assertThat(CoachingInputAssembler.assemble(source(List.of()), NOW).skip())
                .isEqualTo(Skip.INPUT_INSUFFICIENT);
        assertThat(CoachingInputAssembler.assemble(source(hrOnly), NOW).skip())
                .isEqualTo(Skip.INPUT_INSUFFICIENT);
    }

    @Test
    void 입력_기준시각이_12초_이상_지나면_만들지_않는다() {
        List<Sample> samples =
                List.of(
                        sample(100, NOW.minusSeconds(12), 150.0, 2.5, 250.0),
                        sample(101, NOW.minusSeconds(1), 150.0, null, 252.0));
        List<Sample> fresh =
                List.of(
                        sample(100, NOW.minusSeconds(11), 150.0, 2.5, 250.0),
                        sample(101, NOW.minusSeconds(1), 150.0, null, 252.0));

        // 속도의 최신 측정이 12초 전이다(더 오래된 지표가 기준). 20초 유효시간에서 발행 하한 5초·호출 상한 3초를 뺀 값이다.
        assertThat(CoachingInputAssembler.assemble(source(samples), NOW).skip())
                .isEqualTo(Skip.INPUT_STALE);
        assertThat(CoachingInputAssembler.assemble(source(fresh), NOW).assembled().inputAsOf())
                .isEqualTo(NOW.minusSeconds(11));
    }

    @Test
    void 경과초가_같은_표본이_여럿이면_가장_최근_측정을_t0로_본다() {
        List<Sample> samples =
                List.of(
                        sample(100, NOW.minusSeconds(30), 150.0, 2.5, 250.0),
                        sample(100, NOW.minusSeconds(1), 151.0, 2.5, 250.0));

        assertThat(CoachingInputAssembler.assemble(source(samples), NOW).assembled().inputAsOf())
                .isEqualTo(NOW.minusSeconds(1));
    }

    @Test
    void 경과초가_가장_큰_표본이_오래됐으면_만들지_않는다() {
        // 경과초가 되돌아간 기록: 가장 큰 경과초(500)는 30초 전에 측정됐고, 최신 측정은 경과초 10이다.
        List<Sample> samples =
                List.of(
                        sample(500, NOW.minusSeconds(30), 150.0, 2.5, 1250.0),
                        sample(10, NOW.minusSeconds(1), 150.0, 2.5, 25.0));

        assertThat(CoachingInputAssembler.assemble(source(samples), NOW).skip())
                .isEqualTo(Skip.INPUT_STALE);
    }

    @Test
    void 기기_시각이_앞선_표본은_지금_측정된_것으로_본다() {
        List<Sample> future = List.of(sample(100, NOW.plusSeconds(30), 150.0, 2.5, 250.0));

        var assembled = CoachingInputAssembler.assemble(source(future), NOW).assembled();

        assertThat(assembled.inputAsOf()).isEqualTo(NOW);
        assertThat(assembled.request().context().inputAsOf()).isEqualTo(NOW);
    }

    @Test
    void 기준_페이스가_범위를_벗어나면_만들지_않는다() {
        // 0.5m/s = 2000초/km
        List<Sample> slow = List.of(sample(100, NOW.minusSeconds(1), 150.0, 0.5, 50.0));

        assertThat(CoachingInputAssembler.assemble(source(slow), NOW).skip())
                .isEqualTo(Skip.NO_ANCHOR_PACE);
    }
}
