package com.runway.backend.domain.course.dto.response;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.util.List;

/**
 * 선택 저장 전 추천 후보. DB course id 없음. 설명·점수는 생성기 원문을 일반 텍스트로 전달하고, 경사는 백엔드가 DEM으로
 * 계산한 100m 목록이다. {@code candidateToken}은 이 후보를 C10으로 저장할 때 route·distanceM·elevationProfile과 함께 그대로
 * 보내는 서명이다(서버는 후보를 보관하지 않는다).
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
        List<ScoreTermResponse> scoreTerms,
        String candidateToken) {

    /** Route score_terms 항목의 camelCase 표현. */
    public record ScoreTermResponse(
            String term,
            String label,
            String group,
            double featureValue,
            double weight,
            double contribution) {}
}
