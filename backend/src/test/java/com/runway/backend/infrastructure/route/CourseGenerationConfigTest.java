package com.runway.backend.infrastructure.route;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.elevation.CourseElevationSource;
import com.runway.backend.domain.course.elevation.PreparedCourseGrade;
import com.runway.backend.domain.course.recommend.CourseRecommendCommand;
import com.runway.backend.domain.course.recommend.CourseRecommendFilters;
import com.runway.backend.domain.course.recommend.CourseRecommendPort;
import com.runway.backend.domain.course.recommend.CourseRecommendShape;
import com.runway.backend.domain.course.recommend.StubCourseRecommendAdapter;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.infrastructure.dem.CourseDemConfig;
import com.runway.backend.infrastructure.dem.GeoTiffElevationSource;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import tools.jackson.databind.json.JsonMapper;

/** AC-7·9: 생성기·DEM 설정 선택. 기본은 Route HTTP, 스텁은 명시할 때만, DEM이 없어도 서버는 기동한다. */
class CourseGenerationConfigTest {

    private static final Path AREA_DEM = Path.of("src/test/resources/course-grade/dem/area.tif");

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner()
                    .withUserConfiguration(RouteConfig.class, CourseDemConfig.class)
                    .withBean(JsonMapper.class, () -> JsonMapper.builder().build())
                    .withBean(Clock.class, Clock::systemUTC);

    private static CourseRecommendCommand command() {
        return new CourseRecommendCommand(
                35.1796, 129.0756, 5, CourseRecommendShape.LOOP, null, null,
                CourseRecommendFilters.allOff(), 1);
    }

    private static String sha256(Path path) throws Exception {
        return HexFormat.of()
                .formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path)));
    }

    @Test
    void 설정이_없으면_Route_HTTP를_쓰고_호출은_ROUTE_UNAVAILABLE이며_경사는_준비되지_않음이다() {
        runner.run(
                context -> {
                    assertThat(context).hasNotFailed();
                    CourseRecommendPort port = context.getBean(CourseRecommendPort.class);
                    assertThat(port).isInstanceOf(RouteHttpCourseRecommendAdapter.class);
                    assertThatThrownBy(() -> port.recommend(command(), Instant.now().plusSeconds(20)))
                            .isInstanceOfSatisfying(
                                    ApiException.class,
                                    ex ->
                                            assertThat(ex.details())
                                                    .containsEntry("reason", "ROUTE_UNAVAILABLE"));
                    assertThat(context.getBean(PreparedCourseGrade.class).gradeService()).isEmpty();
                    assertThat(context.getBean(CourseElevationSource.class).source()).isEmpty();
                });
    }

    @Test
    void stub을_명시하면_스텁과_개발용_합성고도를_쓴다() {
        runner.withPropertyValues("runway.course.route.mode=STUB")
                .run(
                        context -> {
                            assertThat(context.getBean(CourseRecommendPort.class))
                                    .isInstanceOf(StubCourseRecommendAdapter.class);
                            assertThat(context.getBean(PreparedCourseGrade.class).gradeService())
                                    .isPresent();
                            // 합성 고도는 코스 전용이다. 개인화(경사)에는 노출하지 않아 MISSING이 된다.
                            assertThat(context.getBean(CourseElevationSource.class).source()).isEmpty();
                        });
    }

    @Test
    void 알수없는_모드나_잘못된_주소는_기동을_실패시킨다() {
        runner.withPropertyValues("runway.course.route.mode=fallback")
                .run(context -> assertThat(context).hasFailed());
        for (String url :
                new String[] {
                    "ftp://route:8000",
                    "http://user:pw@route:8000",
                    "http://route:8000/internal",
                    "http://route:8000?x=1",
                    "route:8000"
                }) {
            runner.withPropertyValues("runway.course.route.base-url=" + url)
                    .run(context -> assertThat(context).hasFailed());
        }
    }

    @Test
    void origin_주소는_정규화해_사용한다() {
        assertThat(RouteConfig.parseBaseUrl(" http://route:8000/ "))
                .isEqualTo(URI.create("http://route:8000"));
        assertThat(RouteConfig.parseBaseUrl("")).isNull();
    }

    @Test
    void DEM_해시가_맞으면_준비되고_틀리거나_파일이_없으면_서버는_기동하되_준비되지_않음이다() throws Exception {
        String good = sha256(AREA_DEM);
        runner.withPropertyValues(
                        "runway.course.dem.path=" + AREA_DEM.toAbsolutePath(),
                        "runway.course.dem.sha256=" + good)
                .run(
                        context -> {
                            assertThat(context.getBean(PreparedCourseGrade.class).gradeService()).isPresent();
                            assertThat(context.getBean(CourseElevationSource.class).source())
                                    .containsInstanceOf(GeoTiffElevationSource.class);
                        });
        runner.withPropertyValues(
                        "runway.course.dem.path=" + AREA_DEM.toAbsolutePath(),
                        "runway.course.dem.sha256=" + "0".repeat(64))
                .run(
                        context -> {
                            assertThat(context).hasNotFailed();
                            assertThat(context.getBean(PreparedCourseGrade.class).gradeService()).isEmpty();
                            assertThat(context.getBean(CourseElevationSource.class).source()).isEmpty();
                        });
        runner.withPropertyValues(
                        "runway.course.dem.path=missing/dem.tif", "runway.course.dem.sha256=" + good)
                .run(context -> assertThat(context.getBean(PreparedCourseGrade.class).gradeService()).isEmpty());
        // 실제 모드에서는 DEM이 없을 때 합성 고도로 대체하지 않는다.
        runner.withPropertyValues("runway.course.dem.path=" + AREA_DEM.toAbsolutePath())
                .run(context -> assertThat(context.getBean(PreparedCourseGrade.class).gradeService()).isEmpty());
    }
}
