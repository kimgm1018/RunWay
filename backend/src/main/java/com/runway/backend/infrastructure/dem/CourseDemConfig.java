package com.runway.backend.infrastructure.dem;

import com.runway.backend.domain.course.elevation.CourseElevationSource;
import com.runway.backend.domain.course.elevation.PreparedCourseGrade;
import com.runway.backend.domain.course.recommend.StubElevationSource;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.infrastructure.route.RouteProperties;

import lombok.extern.slf4j.Slf4j;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.nio.file.Path;

/**
 * 기동 시 DEM을 한 번 읽어 SHA-256을 대조한다. 없거나 맞지 않아도 서버는 기동하며 C01만 {@code GRADE_NOT_READY}가 된다.
 * 개발용 스텁 모드에서 DEM이 없을 때만 합성 고도를 쓴다(S15P31E105-423 D-5).
 */
@Slf4j
@Configuration
@EnableConfigurationProperties({CourseDemProperties.class, RouteProperties.class})
public class CourseDemConfig {

    @Bean
    PreparedCourseGrade preparedCourseGrade(
            CourseDemProperties demProperties, RouteProperties routeProperties) {
        String path = demProperties.getPath();
        String sha256 = demProperties.getSha256();
        boolean configured =
                path != null && !path.isBlank() && sha256 != null && !sha256.isBlank();
        if (configured) {
            try {
                Path file = Path.of(path.trim());
                if (!java.nio.file.Files.isRegularFile(file)) {
                    // 경로 값은 남기지 않는다. 볼륨 미연결과 파일 손상을 구분하려는 로그다.
                    log.warn("코스 DEM 파일 없음: 경사 계산을 준비되지 않음으로 둔다.");
                    return PreparedCourseGrade.notReady();
                }
                PreparedCourseGrade prepared =
                        PreparedCourseGrade.of(GeoTiffElevationSource.load(file, sha256.trim()));
                log.info("코스 DEM 준비 완료");
                return prepared;
            } catch (ApiException | IllegalArgumentException ex) {
                // 경로·해시·파일 내용은 로그에 남기지 않는다.
                log.warn("코스 DEM 해시·형식 검증 실패: 경사 계산을 준비되지 않음으로 둔다.");
                return PreparedCourseGrade.notReady();
            }
        }
        if (routeProperties.isStubMode()) {
            log.warn("코스 DEM 미설정: 개발용 스텁 모드라 합성 고도를 사용한다.");
            return PreparedCourseGrade.of(new StubElevationSource());
        }
        log.warn("코스 DEM 미설정: C01은 GRADE_NOT_READY로 응답한다.");
        return PreparedCourseGrade.notReady();
    }

    /**
     * 심박 개인화 변환(경사)용 DEM만 노출한다. 개발 stub 합성 고도({@link StubElevationSource})는 개인화에 넣지 않는다 —
     * stub이면 비어 있어 경사는 MISSING이 된다(S15P31E105-410 D-2, 423 D-5).
     */
    @Bean
    CourseElevationSource courseElevationSource(PreparedCourseGrade preparedCourseGrade) {
        return new CourseElevationSource(
                preparedCourseGrade
                        .elevationSource()
                        .filter(GeoTiffElevationSource.class::isInstance));
    }
}
