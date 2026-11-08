package com.runway.backend.domain.course.elevation;

import java.util.Optional;

/**
 * 기동 시 준비한 DEM 고도 조회를 코스 경사 계산({@link PreparedCourseGrade}) 없이 쓰기 위한 Bean. 심박 개인화(AI06) 변환의 경사 계산이
 * 쓴다. DEM이 없거나 검증에 실패하면 비어 있으며 호출자는 경사를 MISSING으로 둔다.
 *
 * <p>Spring은 {@code Optional<ElevationSource>} 주입 지점을 Optional 자체가 아닌 {@link ElevationSource} Bean으로 해석하므로
 * Optional을 이 래퍼에 담아 노출한다.
 */
public record CourseElevationSource(Optional<ElevationSource> source) {}
