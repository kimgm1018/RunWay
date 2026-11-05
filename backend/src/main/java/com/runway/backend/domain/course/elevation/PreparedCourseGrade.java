package com.runway.backend.domain.course.elevation;

import com.runway.backend.domain.course.service.CourseGradeService;
import java.util.Objects;
import java.util.Optional;

/**
 * 기동 시 준비한 경사 계산기. DEM이 설정되지 않았거나 검증에 실패하면 비어 있으며, 이때 C01은 {@code GRADE_NOT_READY}로
 * 실패한다. 가짜 평지로 대체하지 않는다.
 */
public final class PreparedCourseGrade {

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
}
