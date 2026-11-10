package com.runway.backend.domain.session.dto.response;

import java.util.List;

/**
 * S11 러닝 경로 조회(sessions.md S11). 출처 선택·정확도·구간 분리를 적용한 표시용 좌표 조각이며 측정 시각·정확도·기기 ID는 넣지 않는다.
 * coordinates의 각 원소는 WGS84 [경도, 위도]다.
 */
public record RunningRouteResponse(long sessionId, List<Segment> segments) {

    public record Segment(String source, List<double[]> coordinates) {}
}
