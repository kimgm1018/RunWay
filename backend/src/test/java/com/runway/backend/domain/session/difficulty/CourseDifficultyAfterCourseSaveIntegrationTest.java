package com.runway.backend.domain.session.difficulty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.dto.request.GeneratedCourseSaveCommand;
import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.domain.course.service.CourseService;
import com.runway.backend.global.geo.GeoJsonLineString;
import com.runway.backend.infrastructure.ai.FakeAiServer;
import com.runway.backend.support.SharedPostgres;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 생성 코스 저장 커밋 → 커밋 후 이벤트 → AI05 HTTP 호출 → 비율 저장 — 297 플랜 AC-2·AC-3(T-1). AI 서버 주소가 필요해 공유 컨텍스트를 쓰지 않는다.
 * AI 서버는 루프백 가짜 서버이며 모든 값은 합성 데이터다.
 */
@SpringBootTest
class CourseDifficultyAfterCourseSaveIntegrationTest {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(CourseDifficultyAfterCourseSaveIntegrationTest.class);
    static final FakeAiServer AI = new FakeAiServer();

    private static final BigDecimal DISTANCE_M = new BigDecimal("2500.00");
    private static final GeoJsonLineString ROUTE =
            GeoJsonLineString.of(
                    List.of(List.of(129.0, 35.0), List.of(129.01, 35.01), List.of(129.02, 35.0)));

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.ai.pace-plan.base-url", () -> AI.baseUri().toString());
    }

    @AfterAll
    static void stopAi() {
        AI.close();
    }

    @Autowired private CourseService courseService;
    @Autowired private CourseDifficultyDispatcher dispatcher;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper jsonMapper;
    @Autowired private TransactionTemplate transactionTemplate;

    @BeforeEach
    void reset() throws InterruptedException {
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
        jdbc.update("DELETE FROM courses");
        AI.reset();
    }

    /** 0부터 100m 간격(마지막은 남은 거리). */
    private static List<GradeSegment> profile() {
        BigDecimal step = BigDecimal.valueOf(100);
        List<GradeSegment> result = new java.util.ArrayList<>();
        for (BigDecimal start = BigDecimal.ZERO;
                start.compareTo(DISTANCE_M) < 0;
                start = start.add(step)) {
            result.add(new GradeSegment(start, start.add(step).min(DISTANCE_M), new BigDecimal("1.5")));
        }
        return result;
    }

    private static GeneratedCourseSaveCommand command() {
        return new GeneratedCourseSaveCommand(ROUTE, DISTANCE_M, null, profile());
    }

    private int rows(long courseId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM course_segment_difficulties WHERE course_id=?",
                Integer.class,
                courseId);
    }

    private void awaitIdle() throws InterruptedException {
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
    }

    @Test
    void 생성코스를_저장하면_커밋_후_AI05_비율을_저장한다() throws Exception {
        AI.respond(200, "{\"plannerVersion\":\"planner-v1\",\"segmentDifficultyRatios\":[1.2,0.8,1.0]}");

        long courseId = courseService.saveGeneratedCourse(command()).courseId();
        awaitIdle();

        assertThat(AI.received()).hasSize(1);
        assertThat(AI.received().get(0).path()).isEqualTo("/v1/pace/plan");
        JsonNode request = jsonMapper.readTree(AI.received().get(0).body());
        assertThat(request.get("courseId").longValue()).isEqualTo(courseId);
        assertThat(request.has("userId")).isFalse();
        assertThat(request.get("gradeProfile").size()).isEqualTo(25);
        assertThat(request.get("gradeProfile").get(24).get("endDistanceM").decimalValue())
                .isEqualByComparingTo("2500");

        assertThat(rows(courseId)).isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT ratios::text FROM course_segment_difficulties WHERE course_id=?",
                                String.class,
                                courseId))
                .isEqualTo("[1.2, 0.8, 1.0]");
    }

    @Test
    void 같은_경로를_다시_저장하면_비율이_있으면_AI를_다시_부르지_않는다() throws Exception {
        AI.respond(200, "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.2,0.8,1.0]}");
        long courseId = courseService.saveGeneratedCourse(command()).courseId();
        awaitIdle();

        var again = courseService.saveGeneratedCourse(command());
        awaitIdle();

        assertThat(again.reused()).isTrue();
        assertThat(again.courseId()).isEqualTo(courseId);
        assertThat(AI.received()).hasSize(1);
    }

    @Test
    void AI가_실패하면_저장하지_않고_같은_경로_재저장_때_다시_시도한다() throws Exception {
        AI.respond(503, "{\"code\":\"AI_BUSY\",\"message\":\"busy\"}");
        long courseId = courseService.saveGeneratedCourse(command()).courseId();
        awaitIdle();
        assertThat(rows(courseId)).isZero();

        AI.respond(200, "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.2,0.8,1.0]}");
        courseService.saveGeneratedCourse(command());
        awaitIdle();

        assertThat(AI.received()).hasSize(2);
        assertThat(rows(courseId)).isEqualTo(1);
    }

    @Test
    void AI_응답이_계약과_다르면_저장하지_않는다() throws Exception {
        AI.respond(200, "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.2,0.8]}");

        long courseId = courseService.saveGeneratedCourse(command()).courseId();
        awaitIdle();

        assertThat(AI.received()).hasSize(1);
        assertThat(rows(courseId)).isZero();
    }

    @Test
    void AI05가_경사_비율_없음_경고를_붙이면_저장하지_않는다() throws Exception {
        AI.respond(
                200,
                """
                {"plannerVersion":"prerun_planner_v1","segmentDifficultyRatios":[1.0,1.0,1.0],
                 "warnings":[{"code":"COURSE_PACE_RATIO_MISSING","message":"synthetic"}]}
                """);

        long courseId = courseService.saveGeneratedCourse(command()).courseId();
        awaitIdle();

        assertThat(AI.received()).hasSize(1);
        assertThat(rows(courseId)).isZero();
    }

    @Test
    void 저장이_롤백되면_AI를_부르지_않는다() throws Exception {
        AI.respond(200, "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.2,0.8,1.0]}");

        assertThatThrownBy(
                        () ->
                                transactionTemplate.executeWithoutResult(
                                        status -> {
                                            courseService.saveGeneratedCourse(command());
                                            throw new IllegalStateException("synthetic rollback");
                                        }))
                .isInstanceOf(IllegalStateException.class);
        awaitIdle();

        assertThat(AI.received()).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM courses", Integer.class)).isZero();
    }
}
