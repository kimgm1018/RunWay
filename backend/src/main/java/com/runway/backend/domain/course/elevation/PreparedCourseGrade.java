package com.runway.backend.domain.course.elevation;

import com.runway.backend.domain.course.service.CourseGradeService;
import java.util.Objects;
import java.util.Optional;

/**
 * 기동 시 준비한 경사 계산기. DEM이 설정되지 않았거나 검증에 실패하면 비어 있으며, 이때 C01은 {@code GRADE_NOT_READY}로
 * 실패한다. 가짜 평지로 대체하지 않는다.
 *
 * <p>DEM 자원의 소유자다. Spring은 Bean 해제 콜백({@link #close()})을 이 Bean에 의존하는 Bean을 정리한 뒤 부른다.
 */
public final class PreparedCourseGrade implements AutoCloseable {

    private final CourseGradeService gradeService;
    private final ElevationSource elevationSource;

    private PreparedCourseGrade(CourseGradeService gradeService, ElevationSource elevationSource) {
        this.gradeService = gradeService;
        this.elevationSource = elevationSource;
    }

    public static PreparedCourseGrade notReady() {
        return new PreparedCourseGrade(null, null);
    }

    public static PreparedCourseGrade of(ElevationSource source) {
        Objects.requireNonNull(source);
        return new PreparedCourseGrade(new CourseGradeService(source), source);
    }

    public Optional<CourseGradeService> gradeService() {
        return Optional.ofNullable(gradeService);
    }

    /** 준비된 DEM 고도 조회. 준비되지 않았으면 비어 있다. */
    public Optional<ElevationSource> elevationSource() {
        return Optional.ofNullable(elevationSource);
    }

    /** 닫을 수 있는 고도 소스(파일 기반 DEM)만 닫는다. 미준비·개발 stub은 아무 일도 하지 않으며 여러 번 불러도 안전하다. */
    @Override
    public void close() {
        if (elevationSource instanceof AutoCloseable closeable) {
            try {
                closeable.close();
            } catch (RuntimeException ex) {
                throw ex;
            } catch (Exception ex) {
                // 경로·파일 정보가 담길 수 있는 원인 메시지는 붙이지 않는다.
                throw new IllegalStateException("DEM 자원을 닫지 못했다.");
            }
        }
    }
}
