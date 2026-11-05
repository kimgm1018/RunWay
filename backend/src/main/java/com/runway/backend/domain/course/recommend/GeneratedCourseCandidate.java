package com.runway.backend.domain.course.recommend;

import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.util.List;

/**
 * 검증된 생성 후보 하나. 설명 문구·점수는 생성기 원문이며 백엔드가 다시 쓰지 않는다.
 *
 * @param index 응답 안 순번(0부터). 코스 ID가 아니다
 * @param distanceM 생성기가 계산한 경로 길이(m, 소수 둘째 자리)
 * @param route WGS84 GeoJSON LineString([경도, 위도])
 */
public record GeneratedCourseCandidate(
        int index,
        BigDecimal distanceM,
        GeoJsonLineString route,
        String summary,
        List<String> reasons,
        List<String> caveats,
        double score,
        List<ScoreTerm> scoreTerms) {

    public GeneratedCourseCandidate {
        reasons = List.copyOf(reasons);
        caveats = List.copyOf(caveats);
        scoreTerms = List.copyOf(scoreTerms);
    }

    /** 항목별 점수. term·group은 열린 집합이다. */
    public record ScoreTerm(
            String term,
            String label,
            String group,
            double featureValue,
            double weight,
            double contribution) {}
}
