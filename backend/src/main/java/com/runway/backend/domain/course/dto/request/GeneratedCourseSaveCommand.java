package com.runway.backend.domain.course.dto.request;

import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * AI가 생성한 코스의 서버 내부 저장 입력. 공개 API 요청 DTO가 아니며 외부 엔드포인트는 별도 업무에서 정한다.
 *
 * @param distanceM 코스 총거리(m), {@code courses.distance}
 * @param elevationGainM 누적 상승(m), 모르면 null
 * @param gradeProfile 100m 경사 조각 목록, {@code courses.elevation_profile}
 */
public record GeneratedCourseSaveCommand(
        GeoJsonLineString route,
        BigDecimal distanceM,
        BigDecimal elevationGainM,
        List<GradeSegment> gradeProfile) {

    public GeneratedCourseSaveCommand {
        // 검증기가 null 원소를 거절할 수 있도록 List.copyOf 대신 null 허용 복사본을 쓴다.
        gradeProfile =
                gradeProfile == null
                        ? null
                        : Collections.unmodifiableList(new ArrayList<>(gradeProfile));
    }
}
