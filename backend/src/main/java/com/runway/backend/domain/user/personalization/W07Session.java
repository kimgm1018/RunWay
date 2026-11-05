package com.runway.backend.domain.user.personalization;

import java.time.Instant;
import java.util.List;

/**
 * 변환기 입력: DB에서 읽은 완료 러닝 하나의 W07 원본({@code running_metric_samples}, {@code running_route_points}).
 * 시각순으로 정렬되어 있다. 건강·GPS 정보이므로 값을 로그에 남기지 않는다.
 *
 * @param sessionId 서버 세션 ID
 * @param startedAt {@code running_sessions.started_at}
 * @param samples 지표 샘플(시각 오름차순)
 * @param routePoints 경로점(시각 오름차순). 기기 종류가 붙어 있다.
 */
public record W07Session(
        long sessionId,
        Instant startedAt,
        List<W07MetricSample> samples,
        List<W07RoutePoint> routePoints) {

    @Override
    public String toString() {
        return "W07Session[sessionId=" + sessionId + ", REDACTED]";
    }
}
