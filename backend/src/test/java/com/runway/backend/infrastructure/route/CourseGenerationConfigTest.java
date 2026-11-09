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

    @Test
    void closesDemOnContextShutdownAndBindsCacheBudget() throws Exception {
        var source = new java.util.concurrent.atomic.AtomicReference<GeoTiffElevationSource>();
        runner.withPropertyValues("runway.course.dem.path=" + AREA_DEM.toAbsolutePath(),
                        "runway.course.dem.sha256=" + sha256(AREA_DEM),
                        "runway.course.dem.cache-bytes=1048576")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    var dem = (GeoTiffElevationSource) context.getBean(PreparedCourseGrade.class)
                            .elevationSource().orElseThrow();
                    assertThat(dem.elevationAt(11, 49)).isEqualTo(5.5);
                    source.set(dem);
                });
        assertThatThrownBy(() -> source.get().elevationAt(11, 49)).isInstanceOf(ApiException.class);
    }

    @Test
    void 캐시_예산이_범위_밖이거나_숫자가_아니면_설정_이름을_담아_기동을_실패시킨다() throws Exception {
        for (String budget :
                new String[] {"0", "-1", "1048575", "268435457", "32MB", "lots"}) {
            runner.withPropertyValues("runway.course.dem.path=" + AREA_DEM.toAbsolutePath(),
                            "runway.course.dem.sha256=" + sha256(AREA_DEM),
                            "runway.course.dem.cache-bytes=" + budget)
                    .run(context -> {
                        assertThat(context).hasFailed();
                        assertThat(context.getStartupFailure())
                                .hasStackTraceContaining("runway.course.dem.cache-bytes")
                                .hasStackTraceContaining(budget);
                    });
            // DEM을 설정하지 않은 환경에서도 잘못된 값은 숨기지 않는다.
            runner.withPropertyValues("runway.course.dem.cache-bytes=" + budget)
                    .run(context -> assertThat(context).hasFailed());
        }
        for (String budget : new String[] {"1048576", "33554433", "268435456"}) {
            runner.withPropertyValues("runway.course.dem.path=" + AREA_DEM.toAbsolutePath(),
                            "runway.course.dem.sha256=" + sha256(AREA_DEM),
                            "runway.course.dem.cache-bytes=" + budget)
                    .run(context -> {
                        assertThat(context).hasNotFailed();
                        assertThat(context.getBean(PreparedCourseGrade.class).gradeService()).isPresent();
                    });
        }
    }

    /** B-1: DEM은 소유 Bean의 해제 콜백으로 닫혀, 이 Bean에 의존하는 Bean의 종료 작업이 끝난 뒤에 닫힌다. */
    @Test
    void DEM은_의존하는_Bean의_종료_작업이_끝난_뒤에_닫힌다() throws Exception {
        ELEVATION_AT_SHUTDOWN.set(null);
        var source = new java.util.concurrent.atomic.AtomicReference<GeoTiffElevationSource>();
        // 소비자 설정을 먼저 등록해 해제 등록 순서상 DEM 정리보다 늦게 정리될 수 있는 조건을 만든다.
        new ApplicationContextRunner()
                .withUserConfiguration(DemConsumerConfig.class, RouteConfig.class, CourseDemConfig.class)
                .withBean(JsonMapper.class, () -> JsonMapper.builder().build())
                .withBean(Clock.class, Clock::systemUTC)
                .withPropertyValues("runway.course.dem.path=" + AREA_DEM.toAbsolutePath(),
                        "runway.course.dem.sha256=" + sha256(AREA_DEM))
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    source.set((GeoTiffElevationSource) context.getBean(PreparedCourseGrade.class)
                            .elevationSource().orElseThrow());
                });
        assertThat(ELEVATION_AT_SHUTDOWN.get()).isEqualTo(5.5);
        assertThatThrownBy(() -> source.get().elevationAt(11, 49)).isInstanceOf(ApiException.class);
    }

    private static final java.util.concurrent.atomic.AtomicReference<Object> ELEVATION_AT_SHUTDOWN =
            new java.util.concurrent.atomic.AtomicReference<>();

    /** 개인화 디스패처처럼 종료 시 남은 작업이 DEM을 읽는 소비자. */
    @org.springframework.context.annotation.Configuration(proxyBeanMethods = false)
    static class DemConsumerConfig {
        @org.springframework.context.annotation.Bean
        org.springframework.beans.factory.DisposableBean demConsumer(CourseElevationSource elevation) {
            return () -> {
                try {
                    ELEVATION_AT_SHUTDOWN.set(elevation.source().orElseThrow().elevationAt(11, 49));
                } catch (RuntimeException ex) {
                    ELEVATION_AT_SHUTDOWN.set(ex);
                }
            };
        }
    }
}
