package com.runway.backend.domain.user.personalization;

import java.time.Instant;

/**
 * {@code running_metric_samples} 한 행에서 변환에 쓰는 열. 값이 없으면 null이다.
 *
 * @param measuredAt {@code measured_at}(마이크로초 정밀도 유지)
 * @param heartRate {@code heart_rate}(bpm)
 * @param hrMeasured {@code is_hr_measured}
 * @param totalDistance {@code total_distance}(m, 누적)
 * @param speed {@code speed}(m/s)
 */
public record W07MetricSample(
        Instant measuredAt,
        Double heartRate,
        boolean hrMeasured,
        Double totalDistance,
        Double speed) {

    @Override
    public String toString() {
        return "W07MetricSample[REDACTED]";
    }
}
