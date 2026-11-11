package com.runway.backend.domain.course.service;

import com.runway.backend.domain.course.candidate.CourseCandidateSigner;
import com.runway.backend.domain.course.candidate.CourseCandidateSignerTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.course.dto.request.RecommendCoursesRequest;
import com.runway.backend.domain.course.dto.response.RecommendCoursesResponse;
import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.domain.course.elevation.PreparedCourseGrade;
import com.runway.backend.domain.course.recommend.CourseRecommendCommand;
import com.runway.backend.domain.course.recommend.CourseRecommendPort;
import com.runway.backend.domain.course.recommend.GeneratedCourseCandidate;
import com.runway.backend.domain.course.recommend.GeneratedCourseCandidate.ScoreTerm;
import com.runway.backend.domain.course.recommend.GeneratedCourses;
import com.runway.backend.domain.course.repository.CourseJdbcRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** AC-3·4·7·8: 검증 후 생성기 호출, 후보별 경사 조합, DEM 준비/실패, C01 전체 예산. */
class CourseRecommendServiceTest {

    private static final long USER_ID = 7L;
    private static final double START_LAT = 35.1796;
    private static final double START_LON = 129.0756;

    private final CourseJdbcRepository repository = mock(CourseJdbcRepository.class);
    private final MutableClock clock = new MutableClock(Instant.parse("2026-11-05T00:00:00Z"));
    private final List<CourseRecommendCommand> calls = new ArrayList<>();
    private final List<Instant> deadlines = new ArrayList<>();
    private final CourseCandidateSigner signer = CourseCandidateSignerTest.signer(clock);

    /** 경사 계산 결과가 비교 가능하도록 남북 방향으로 완만하게 오르는 합성 고도. */
    private static final ElevationSource SLOPE = (lon, lat) -> (lat - START_LAT) * 20_000;

    CourseRecommendServiceTest() {
        when(repository.existsUserById(USER_ID)).thenReturn(true);
    }

    private CourseRecommendPort port(GeneratedCourses result) {
        return (command, deadline) -> {
            calls.add(command);
            deadlines.add(deadline);
            return result;
        };
    }

    private CourseRecommendService service(CourseRecommendPort port, PreparedCourseGrade grade) {
        return new CourseRecommendService(
                repository, port, grade, signer, clock, Duration.ofSeconds(20));
    }

    private static RecommendCoursesRequest request(double latitude, double longitude) {
        return new RecommendCoursesRequest(latitude, longitude, 5.0, null, null, null, null, null);
    }

    private static GeoJsonLineString loop(double offsetDeg) {
        List<List<Double>> points = new ArrayList<>();
        double radiusDeg = 0.007;
        for (int i = 0; i <= 40; i++) {
            double theta = Math.toRadians(offsetDeg) + 2 * Math.PI * i / 40;
            points.add(
                    List.of(
                            START_LON + radiusDeg * Math.sin(theta),
                            START_LAT + radiusDeg * (1 - Math.cos(theta))));
        }
        points.set(points.size() - 1, points.getFirst());
        return GeoJsonLineString.of(points);
    }

    private static GeneratedCourses generated(int count) {
        List<GeneratedCourseCandidate> candidates = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            candidates.add(
                    new GeneratedCourseCandidate(
                            i,
                            new BigDecimal("5000.00"),
                            loop(i * 90),
                            "요약 " + i,
                            List.of("이유 " + i),
                            List.of(),
                            1.5 - i,
                            List.of(new ScoreTerm("river", "강변", "preference", 0.4, 5, 2.0))));
        }
        return new GeneratedCourses(candidates, List.of("안내"), 25);
    }

    private static ApiException failureOf(Runnable call) {
        try {
            call.run();
        } catch (ApiException ex) {
            return ex;
        }
        throw new AssertionError("ApiException이 발생해야 합니다.");
    }

    @Test
    void 후보마다_DEM_경사를_계산해_생성기_설명점수와_함께_반환한다() {
        GeneratedCourses generated = generated(2);
        var service = service(port(generated), PreparedCourseGrade.of(SLOPE));

        RecommendCoursesResponse response = service.recommend(USER_ID, request(START_LAT, START_LON));

        var calculator = new CourseGradeService(SLOPE);
        assertThat(response.courses()).hasSize(2);
        for (int i = 0; i < 2; i++) {
            var item = response.courses().get(i);
            var candidate = generated.courses().get(i);
            assertThat(item.index()).isEqualTo(i);
            assertThat(item.route()).isEqualTo(candidate.route());
            assertThat(item.distanceM()).isEqualByComparingTo("5000.00");
            assertThat(item.elevationProfile())
                    .isNotEmpty()
                    .isEqualTo(calculator.calculate(candidate.route(), candidate.distanceM()));
            assertThat(item.elevationProfile())
                    .anySatisfy(segment -> assertThat(segment.gradePercent().signum()).isNotZero());
            assertThat(item.summary()).isEqualTo("요약 " + i);
            // 발급한 서명은 같은 사용자·같은 후보 값으로 검증된다.
            signer.verify(
                    USER_ID,
                    item.candidateToken(),
                    item.route(),
                    item.distanceM(),
                    item.elevationProfile());
            assertThat(item.reasons()).containsExactly("이유 " + i);
            assertThat(item.caveats()).isEmpty();
            assertThat(item.score()).isEqualTo(1.5 - i);
            assertThat(item.scoreTerms())
                    .singleElement()
                    .satisfies(
                            term -> {
                                assertThat(term.term()).isEqualTo("river");
                                assertThat(term.featureValue()).isEqualTo(0.4);
                                assertThat(term.contribution()).isEqualTo(2.0);
                            });
        }
        assertThat(response.notices()).containsExactly("안내");
        assertThat(response.nextSeed()).isEqualTo(25);
        assertThat(deadlines).containsExactly(Instant.parse("2026-11-05T00:00:20Z"));
    }

    @Test
    void 부산_사각형_밖의_출발좌표도_생성기에_넘긴다() {
        var service = service(port(generated(1)), PreparedCourseGrade.of(SLOPE));

        service.recommend(USER_ID, request(37.5665, 126.9780));

        assertThat(calls).singleElement().satisfies(command -> {
            assertThat(command.latitude()).isEqualTo(37.5665);
            assertThat(command.longitude()).isEqualTo(126.9780);
        });
    }

    private static RecommendCoursesRequest distance(double distanceKm) {
        return new RecommendCoursesRequest(START_LAT, START_LON, distanceKm, null, null, null, null, null);
    }

    /** 출발점에서 정동쪽으로 직선 meters 떨어진 도착점의 편도 21.1 km 요청. */
    private static RecommendCoursesRequest pointToPointEast(double meters) {
        double endLon = START_LON + meters / (111_320d * Math.cos(Math.toRadians(START_LAT)));
        return new RecommendCoursesRequest(
                START_LAT, START_LON, 21.1, "point_to_point", START_LAT, endLon, null, null);
    }

    @Test
    void 하프_마라톤_21점1km까지_생성기에_넘긴다() {
        var service = service(port(generated(1)), PreparedCourseGrade.of(SLOPE));

        service.recommend(USER_ID, distance(21.1));

        assertThat(calls).singleElement().satisfies(command ->
                assertThat(command.distanceKm()).isEqualTo(21.1));
    }

    @Test
    void 거리가_21점1km를_넘으면_생성기를_호출하지_않고_422다() {
        var service = service(port(generated(1)), PreparedCourseGrade.of(SLOPE));

        ApiException failure = failureOf(() -> service.recommend(USER_ID, distance(21.11)));

        assertThat(failure.status().value()).isEqualTo(422);
        assertThat(failure.code()).isEqualTo("INVALID_SEARCH");
        assertThat(failure.getMessage()).isEqualTo("distanceKm는 1.0 이상 21.1 이하여야 합니다.");
        assertThat(calls).isEmpty();
    }

    @Test
    void 편도_직선거리는_23점71km까지_생성기에_넘기고_넘으면_422다() {
        var service = service(port(generated(1)), PreparedCourseGrade.of(SLOPE));

        service.recommend(USER_ID, pointToPointEast(23_600));
        ApiException failure = failureOf(() -> service.recommend(USER_ID, pointToPointEast(23_800)));

        assertThat(calls).hasSize(1);
        assertThat(failure.status().value()).isEqualTo(422);
        assertThat(failure.errorCode()).isEqualTo(ErrorCode.SEARCH_OUT_OF_APP_RANGE);
    }

    @Test
    void 위경도_범위를_벗어나면_생성기를_호출하지_않고_422다() {
        var service = service(port(generated(1)), PreparedCourseGrade.of(SLOPE));

        ApiException failure = failureOf(() -> service.recommend(USER_ID, request(91, START_LON)));

        assertThat(failure.status().value()).isEqualTo(422);
        assertThat(failure.code()).isEqualTo("INVALID_SEARCH");
        assertThat(calls).isEmpty();
    }

    @Test
    void 순환에_함께온_도착좌표도_위경도범위를_검사한다() {
        var service = service(port(generated(1)), PreparedCourseGrade.of(SLOPE));
        var loopWithBadEnd =
                new RecommendCoursesRequest(START_LAT, START_LON, 5.0, "loop", 91.0, START_LON, null, null);

        ApiException failure = failureOf(() -> service.recommend(USER_ID, loopWithBadEnd));

        assertThat(failure.status().value()).isEqualTo(422);
        assertThat(failure.getMessage()).isEqualTo("latitude는 -90~90이어야 합니다.");
        assertThat(calls).isEmpty();
    }

    @Test
    void DEM이_준비되지_않으면_생성기를_호출하지_않고_GRADE_NOT_READY다() {
        var service = service(port(generated(1)), PreparedCourseGrade.notReady());

        ApiException failure =
                failureOf(() -> service.recommend(USER_ID, request(START_LAT, START_LON)));

        assertThat(failure.status().value()).isEqualTo(503);
        assertThat(failure.code()).isEqualTo("SERVICE_UNAVAILABLE");
        assertThat(failure.details()).containsEntry("reason", "GRADE_NOT_READY");
        assertThat(calls).isEmpty();
    }

    @Test
    void 경로에_유효고도가_없으면_가짜_평지로_성공하지않고_GRADE_UNAVAILABLE이다() {
        ElevationSource outside = (lon, lat) -> Double.NaN;
        var service = service(port(generated(1)), PreparedCourseGrade.of(outside));

        ApiException failure =
                failureOf(() -> service.recommend(USER_ID, request(START_LAT, START_LON)));

        assertThat(failure.status().value()).isEqualTo(503);
        assertThat(failure.details()).containsEntry("reason", "GRADE_UNAVAILABLE");
    }

    @Test
    void 준비후_DEM읽기실패는_경로나원인노출없이_GRADE_UNAVAILABLE이다() {
        ElevationSource broken = (lon, lat) -> {
            throw new ApiException(com.runway.backend.global.exception.ErrorCode.SERVICE_UNAVAILABLE);
        };
        var service = service(port(generated(1)), PreparedCourseGrade.of(broken));
        ApiException failure = failureOf(() -> service.recommend(USER_ID, request(START_LAT, START_LON)));
        assertThat(failure.status().value()).isEqualTo(503);
        assertThat(failure.code()).isEqualTo("SERVICE_UNAVAILABLE");
        assertThat(failure.details()).containsOnlyKeys("reason").containsEntry("reason", "GRADE_UNAVAILABLE");
        assertThat(failure.getCause()).isNull();
    }

    @Test
    void 경사계산중_전체예산이_끝나면_부분후보없이_GENERATION_TIMEOUT이다() {
        // 첫 후보 계산 중 시계가 21초 흐른다. 두 번째 후보를 계산하거나 첫 후보만 반환하지 않는다.
        ElevationSource slow =
                (lon, lat) -> {
                    clock.advance(Duration.ofSeconds(21));
                    return SLOPE.elevationAt(lon, lat);
                };
        var service = service(port(generated(3)), PreparedCourseGrade.of(slow));

        ApiException failure =
                failureOf(() -> service.recommend(USER_ID, request(START_LAT, START_LON)));

        assertThat(failure.status().value()).isEqualTo(503);
        assertThat(failure.getMessage())
                .isEqualTo("코스 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
        assertThat(failure.details()).containsEntry("reason", "GENERATION_TIMEOUT");
    }

    @Test
    void 생성기가_예산을_다_쓰고_돌아오면_경사계산없이_GENERATION_TIMEOUT이다() {
        CourseRecommendPort slowPort =
                (command, deadline) -> {
                    clock.advance(Duration.ofSeconds(20));
                    return generated(1);
                };
        ElevationSource mustNotRun =
                (lon, lat) -> {
                    throw new AssertionError("예산 초과 뒤 경사를 계산하면 안 됩니다.");
                };
        var service = service(slowPort, PreparedCourseGrade.of(mustNotRun));

        ApiException failure =
                failureOf(() -> service.recommend(USER_ID, request(START_LAT, START_LON)));

        assertThat(failure.details()).containsEntry("reason", "GENERATION_TIMEOUT");
    }

    @Test
    void 생성기_오류는_그대로_전달하고_다른_생성기로_바꾸지_않는다() {
        var busy =
                new ApiException(
                        com.runway.backend.global.exception.ErrorCode.COURSE_ROUTE_BUSY,
                        java.util.Map.of("reason", "ROUTE_BUSY"));
        CourseRecommendPort failing =
                (command, deadline) -> {
                    calls.add(command);
                    throw busy;
                };
        var service = service(failing, PreparedCourseGrade.of(SLOPE));

        ApiException failure =
                failureOf(() -> service.recommend(USER_ID, request(START_LAT, START_LON)));

        assertThat(failure).isSameAs(busy);
        assertThat(calls).hasSize(1);
    }

    @Test
    void 존재하지않는_사용자는_생성기를_호출하지_않고_UNAUTHORIZED다() {
        var service = service(port(generated(1)), PreparedCourseGrade.of(SLOPE));

        ApiException failure = failureOf(() -> service.recommend(99L, request(START_LAT, START_LON)));

        assertThat(failure.status().value()).isEqualTo(401);
        assertThat(calls).isEmpty();
    }

    /** 테스트에서 시간을 직접 진행시키는 시계. */
    private static final class MutableClock extends Clock {
        private final AtomicReference<Instant> now;

        MutableClock(Instant start) {
            this.now = new AtomicReference<>(start);
        }

        void advance(Duration duration) {
            now.updateAndGet(current -> current.plus(duration));
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now.get();
        }
    }
}
