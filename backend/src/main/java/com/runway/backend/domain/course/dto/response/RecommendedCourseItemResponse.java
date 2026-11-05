package com.runway.backend.domain.course.dto.response;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.util.List;

/**
 * 선택 저장 전 추천 후보. DB course id 없음. 설명·점수는 생성기 원문을 일반 텍스트로 전달하고, 경사는 백엔드가 DEM으로
 * 계산한 100m 목록이다.
 */
public record RecommendedCourseItemResponse(
        int index,
        BigDecimal distanceM,
        GeoJsonLineString route,
        List<GradeSegment> elevationProfile,
        String summary,
        List<String> reasons,
        List<String> caveats,
        double score,
        List<ScoreTermResponse> scoreTerms) {

    /** Route score_terms 항목의 camelCase 표현. */
    public record ScoreTermResponse(
            String term,
            String label,
            String group,
            double featureValue,
            double weight,
            double contribution) {}
}
