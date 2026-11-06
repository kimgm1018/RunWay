package com.runway.backend.domain.session.difficulty;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.difficulty.CourseDifficultyPort.CourseDifficulty;
import com.runway.backend.domain.session.difficulty.CourseDifficultyRunService.Outcome;
import com.runway.backend.domain.session.service.SegmentDifficultyProvider;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 코스 구간 난이도 비율 계산·저장·조회 — 297 플랜 AC-3·AC-4·AC-6(T-2·T-4·T-6). AI 호출은 테스트용 포트로 바꾸고 DB는 실제 마이그레이션 스키마를
 * 쓴다. 모든 값은 합성 데이터다.
 */
class CourseDifficultyIntegrationTest extends SharedContextIntegrationSupport {

    private static final String PROFILE_2500 = profile("2500.0");

    /** 끝 거리가 end인 합성 경사 목록(구조 검사는 C10 저장 쪽 책임이라 여기서는 끝 거리만 의미 있다). */
    private static String profile(String end) {
        return "[{\"startDistanceM\":0.0,\"endDistanceM\":1000.0,\"gradePercent\":2.0},"
                + "{\"startDistanceM\":1000.0,\"endDistanceM\":"
                + end
                + ",\"gradePercent\":-1.0}]";
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CourseDifficultyRepository repository;
    @Autowired private SegmentDifficultyProvider provider;

    /** 호출 횟수를 세고 정해 둔 결과를 돌려주는 포트. */
    private static class ScriptedPort implements CourseDifficultyPort {
        final AtomicInteger calls = new AtomicInteger();
        volatile Optional<CourseDifficulty> result = Optional.empty();
        volatile CountDownLatch gate;

        ScriptedPort returning(String version, String... ratios) {
            result =
                    Optional.of(
                            new CourseDifficulty(
                                    version,
                                    Arrays.stream(ratios).map(BigDecimal::new).toList(),
                                    List.of()));
            return this;
        }

        @Override
        public Optional<CourseDifficulty> segmentDifficulty(long courseId, String gradeProfileJson) {
            calls.incrementAndGet();
            CountDownLatch waitFor = gate;
            if (waitFor != null) {
                try {
                    waitFor.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            return result;
        }
    }

    private long course(String status, String distance, String profile) {
        return jdbc.queryForObject(
                """
                INSERT INTO courses(route,start_position,distance,elevation_profile,status)
                VALUES (ST_GeogFromText('LINESTRING(129.0 35.0, 129.01 35.01)'),
                        ST_GeogFromText('POINT(129.0 35.0)'), ?::numeric, ?::jsonb, ?::courses_status_enum)
                RETURNING id
                """,
                Long.class,
                distance,
                profile,
                status);
    }

    private void store(long courseId, String distance, String ratiosJson) {
        jdbc.update(
                "INSERT INTO course_segment_difficulties(course_id,distance_m,ratios,planner_version)"
                        + " VALUES (?,?::numeric,?::jsonb,'stored')",
                courseId,
                distance,
                ratiosJson);
    }

    private int rows(long courseId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM course_segment_difficulties WHERE course_id=?",
                Integer.class,
                courseId);
    }

    private static List<BigDecimal> decimals(String... values) {
        return Arrays.stream(values).map(BigDecimal::new).toList();
    }

    // --- 계산·저장(AC-2 저장 형식, AC-3, AC-4) ---

    @Test
    void AI_비율을_코스거리와_버전과_함께_저장한다() {
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        ScriptedPort port = new ScriptedPort().returning("planner-v1", "1.2", "0.8", "1.0");

        Outcome outcome = new CourseDifficultyRunService(repository, port).run(courseId);

        assertThat(outcome).isEqualTo(Outcome.SAVED);
        assertThat(port.calls).hasValue(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT distance_m FROM course_segment_difficulties WHERE course_id=?",
                                BigDecimal.class,
                                courseId))
                .isEqualByComparingTo("2500.00");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT planner_version FROM course_segment_difficulties WHERE course_id=?",
                                String.class,
                                courseId))
                .isEqualTo("planner-v1");
        assertThat(repository.find(courseId))
                .hasValueSatisfying(
                        stored ->
                                assertThat(stored.ratios())
                                        .usingElementComparator(BigDecimal::compareTo)
                                        .containsExactlyElementsOf(decimals("1.2", "0.8", "1.0")));
    }

    @Test
    void 계약과_다른_비율은_저장하지_않는다() {
        String[][] invalid = {
            {"1.2", "0.8"}, // 개수 부족(2500m → 3개)
            {"1.2", "0.8", "1.0", "1.0"}, // 개수 초과
            {"1.2", "0", "1.0"},
            {"1.2", "-0.5", "1.0"},
        };
        for (String[] ratios : invalid) {
            long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
            ScriptedPort port = new ScriptedPort().returning("v", ratios);

            assertThat(new CourseDifficultyRunService(repository, port).run(courseId))
                    .as(Arrays.toString(ratios))
                    .isEqualTo(Outcome.INVALID_RESPONSE);
            assertThat(rows(courseId)).isZero();
        }
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        assertThat(
                        new CourseDifficultyRunService(
                                        repository,
                                        new ScriptedPort().returning(" ", "1.0", "1.0", "1.0"))
                                .run(courseId))
                .isEqualTo(Outcome.INVALID_RESPONSE);
        assertThat(
                        new CourseDifficultyRunService(
                                        repository,
                                        new ScriptedPort().returning("v".repeat(81), "1.0", "1.0", "1.0"))
                                .run(courseId))
                .isEqualTo(Outcome.INVALID_RESPONSE);
        assertThat(rows(courseId)).isZero();
    }

    @Test
    void AI_호출이_실패하면_저장하지_않는다() {
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        ScriptedPort port = new ScriptedPort();

        assertThat(new CourseDifficultyRunService(repository, port).run(courseId))
                .isEqualTo(Outcome.AI_FAILED);
        assertThat(port.calls).hasValue(1);
        assertThat(rows(courseId)).isZero();
    }

    @Test
    void 이미_저장됐거나_대상이_아닌_코스는_AI를_부르지_않는다() {
        long saved = course("ACTIVE", "2500.00", PROFILE_2500);
        store(saved, "2500.00", "[1.0,1.0,1.0]");
        long noProfile = course("ACTIVE", "2500.00", null);
        long blocked = course("BLOCKED", "2500.00", PROFILE_2500);
        long merged = course("MERGED", "2500.00", PROFILE_2500);
        long tooLong = course("ACTIVE", "45000.01", PROFILE_2500);
        ScriptedPort port = new ScriptedPort().returning("v", "1.0", "1.0", "1.0");
        CourseDifficultyRunService service = new CourseDifficultyRunService(repository, port);

        assertThat(service.run(saved)).isEqualTo(Outcome.ALREADY_SAVED);
        assertThat(service.run(noProfile)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service.run(blocked)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service.run(merged)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service.run(tooLong)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service.run(Long.MAX_VALUE)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(port.calls).hasValue(0);
        assertThat(rows(saved)).isEqualTo(1);
    }

    @Test
    void 정확히_45km_코스는_45개_비율을_저장한다() {
        long courseId = course("ACTIVE", "45000.00", profile("45000.0"));
        String[] ratios = new String[45];
        Arrays.fill(ratios, "1.0");

        assertThat(
                        new CourseDifficultyRunService(
                                        repository, new ScriptedPort().returning("v", ratios))
                                .run(courseId))
                .isEqualTo(Outcome.SAVED);
    }

    @Test
    void 경사_끝거리로_센_구간수가_다르거나_구간이_1개_이하이면_AI를_부르지_않는다() {
        // 경사 끝은 코스 거리 ±0.99m까지 허용되므로 1km 경계에서 개수가 갈릴 수 있다(리뷰 R-1).
        long boundary = course("ACTIVE", "3000.50", profile("2999.60"));
        long sameCount = course("ACTIVE", "2999.60", profile("3000.00"));
        long oneSegment =
                course(
                        "ACTIVE",
                        "1000.00",
                        "[{\"startDistanceM\":0.0,\"endDistanceM\":1000.0,\"gradePercent\":1.0}]");
        long notArray = course("ACTIVE", "2500.00", "{\"endDistanceM\":2500.0}");
        long noEnd = course("ACTIVE", "2500.00", "[{\"startDistanceM\":0.0,\"gradePercent\":1.0}]");
        ScriptedPort port = new ScriptedPort().returning("v", "1.0", "1.0", "1.0");
        CourseDifficultyRunService service = new CourseDifficultyRunService(repository, port);

        assertThat(service.run(boundary)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service.run(oneSegment)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service.run(notArray)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service.run(noEnd)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(port.calls).hasValue(0);
        // 개수가 같으면(3개) 소수 차이는 문제없다.
        assertThat(service.run(sameCount)).isEqualTo(Outcome.SAVED);
    }

    @Test
    void AI05가_경사_비율_없이_계산했다고_경고하면_저장하지_않는다() {
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        ScriptedPort port = new ScriptedPort();
        port.result =
                Optional.of(
                        new CourseDifficulty(
                                "v",
                                decimals("1.0", "1.0", "1.0"),
                                List.of("FLAT_ASSUMED", "COURSE_PACE_RATIO_MISSING")));

        assertThat(new CourseDifficultyRunService(repository, port).run(courseId))
                .isEqualTo(Outcome.NO_TERRAIN_RATIO);
        assertThat(rows(courseId)).isZero();

        // 다른 경고만 있으면 저장한다.
        port.result =
                Optional.of(
                        new CourseDifficulty(
                                "v", decimals("1.2", "0.8", "1.0"), List.of("CUE_BPM_NOT_COMPUTED")));
        assertThat(new CourseDifficultyRunService(repository, port).run(courseId))
                .isEqualTo(Outcome.SAVED);
    }

    @Test
    void 다른_실행이_먼저_저장했으면_덮어쓰지_않는다() {
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        ScriptedPort port =
                new ScriptedPort() {
                    @Override
                    public Optional<CourseDifficulty> segmentDifficulty(long id, String json) {
                        // AI 응답을 기다리는 사이 다른 서버가 먼저 저장한 상황.
                        store(id, "2500.00", "[2.0,2.0,2.0]");
                        return Optional.of(new CourseDifficulty("v", decimals("1.0", "1.0", "1.0"), List.of()));
                    }
                };

        assertThat(new CourseDifficultyRunService(repository, port).run(courseId))
                .isEqualTo(Outcome.ALREADY_SAVED);
        assertThat(repository.find(courseId).orElseThrow().ratios().get(0))
                .isEqualByComparingTo("2.0");
    }

    // --- 실행기(AC-4 동시 요청) ---

    @Test
    void 같은_코스를_동시에_여러번_요청해도_AI는_한번_행은_하나다() throws Exception {
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        ScriptedPort port = new ScriptedPort().returning("v", "1.2", "0.8", "1.0");
        port.gate = new CountDownLatch(1);
        CourseDifficultyDispatcher dispatcher =
                new CourseDifficultyDispatcher(new CourseDifficultyRunService(repository, port));
        try {
            dispatcher.dispatch(courseId);
            dispatcher.dispatch(courseId);
            dispatcher.dispatch(courseId);
            port.gate.countDown();
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();

            assertThat(port.calls).hasValue(1);
            assertThat(rows(courseId)).isEqualTo(1);

            // 끝난 뒤 다시 요청하면 이미 저장돼 AI를 부르지 않는다.
            dispatcher.dispatch(courseId);
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
            assertThat(port.calls).hasValue(1);
        } finally {
            dispatcher.destroy();
        }
    }

    @Test
    void 실행_중_예외가_나도_실행기가_계속_동작한다() throws Exception {
        long first = course("ACTIVE", "2500.00", PROFILE_2500);
        long second = course("ACTIVE", "2500.00", PROFILE_2500);
        ScriptedPort port =
                new ScriptedPort() {
                    @Override
                    public Optional<CourseDifficulty> segmentDifficulty(long id, String json) {
                        calls.incrementAndGet();
                        if (id == first) throw new IllegalStateException("synthetic");
                        return Optional.of(new CourseDifficulty("v", decimals("1.0", "1.0", "1.0"), List.of()));
                    }
                };
        CourseDifficultyDispatcher dispatcher =
                new CourseDifficultyDispatcher(new CourseDifficultyRunService(repository, port));
        try {
            dispatcher.dispatch(first);
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
            dispatcher.dispatch(second);
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();

            assertThat(rows(first)).isZero();
            assertThat(rows(second)).isEqualTo(1);
            // 실패한 코스도 다시 요청할 수 있다.
            dispatcher.dispatch(first);
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
            assertThat(port.calls).hasValue(3);
        } finally {
            dispatcher.destroy();
        }
    }

    // --- 세션 계획용 조회(AC-5b, AC-6) ---

    @Test
    void 계획_끝거리가_코스거리와_같으면_저장_비율을_그대로_준다() {
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        store(courseId, "2500.00", "[1.2,0.8,1.0]");

        assertThat(provider.ratios(courseId, new BigDecimal("2500.00"), 3))
                .hasValueSatisfying(
                        r ->
                                assertThat(r)
                                        .usingElementComparator(BigDecimal::compareTo)
                                        .containsExactlyElementsOf(decimals("1.2", "0.8", "1.0")));
    }

    @Test
    void 계획_끝거리가_코스보다_짧으면_앞_구간_비율만_준다() {
        long courseId = course("ACTIVE", "5000.00", PROFILE_2500);
        store(courseId, "5000.00", "[1.1,1.2,1.3,1.4,1.5]");

        assertThat(provider.ratios(courseId, new BigDecimal("3000.00"), 3))
                .hasValueSatisfying(
                        r ->
                                assertThat(r)
                                        .usingElementComparator(BigDecimal::compareTo)
                                        .containsExactlyElementsOf(decimals("1.1", "1.2", "1.3")));
        // 2.5km: 마지막 2~2.5km 구간은 2~3km 구간 비율을 쓴다.
        assertThat(provider.ratios(courseId, new BigDecimal("2500.00"), 3))
                .hasValueSatisfying(r -> assertThat(r.get(2)).isEqualByComparingTo("1.3"));
    }

    @Test
    void 목표가_코스보다_조금_길어도_구간수가_같으면_비율을_준다() {
        // 정수 목표 거리(4988)가 소수 코스 거리(4987.60)보다 조금 긴 경우(리뷰 R-2).
        long courseId = course("ACTIVE", "4987.60", profile("4987.6"));
        store(courseId, "4987.60", "[1.1,1.2,1.3,1.4,1.5]");

        assertThat(provider.ratios(courseId, new BigDecimal("4988.00"), 5))
                .hasValueSatisfying(r -> assertThat(r).hasSize(5));
    }

    @Test
    void 비율을_쓸_수_없으면_빈값이다() {
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        long noRow = course("ACTIVE", "2500.00", PROFILE_2500);
        long fewer = course("ACTIVE", "2500.00", PROFILE_2500);
        long notNumbers = course("ACTIVE", "2500.00", PROFILE_2500);
        store(courseId, "2500.00", "[1.2,0.8,1.0]");
        store(fewer, "2500.00", "[1.2,0.8]");
        store(notNumbers, "2500.00", "[1.2,\"x\",1.0]");

        // 목표가 길어 구간 수가 저장 개수보다 많다.
        assertThat(provider.ratios(courseId, new BigDecimal("3000.00"), 4)).isEmpty();
        // 자유러닝·행 없음.
        assertThat(provider.ratios(null, new BigDecimal("2500.00"), 3)).isEmpty();
        assertThat(provider.ratios(noRow, new BigDecimal("2500.00"), 3)).isEmpty();
        // 저장 개수가 필요한 구간 수보다 적다.
        assertThat(provider.ratios(fewer, new BigDecimal("2500.00"), 3)).isEmpty();
        // 저장값을 해석할 수 없다.
        assertThat(provider.ratios(notNumbers, new BigDecimal("2500.00"), 3)).isEmpty();
    }

    @Test
    void 코스를_지우면_비율도_지워진다() {
        long courseId = course("ACTIVE", "2500.00", PROFILE_2500);
        store(courseId, "2500.00", "[1.2,0.8,1.0]");

        jdbc.update("DELETE FROM courses WHERE id=?", courseId);

        assertThat(rows(courseId)).isZero();
    }
}
