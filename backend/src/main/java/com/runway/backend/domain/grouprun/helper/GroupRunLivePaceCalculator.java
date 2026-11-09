package com.runway.backend.domain.grouprun.helper;

import java.math.BigDecimal;

/**
 * G10 참가자 실시간 실측 페이스(S15P31E105-598). W07 {@code running_metric_samples.speed} 평균을 sec/km로
 * 바꾼다. AI04 최근 60초 실측 평균과 같은 창·의미를 쓴다.
 */
public final class GroupRunLivePaceCalculator {

    /** 실측 평균에 쓰는 최근 구간(초). AI04 {@code MEASURED_PACE_WINDOW_SEC}와 같다. */
    public static final int WINDOW_SEC = 60;

    private GroupRunLivePaceCalculator() {}

    /**
     * 평균 속도(m/s)를 정수 페이스(sec/km)로 변환한다. null·비양수·비유한 값은 null.
     *
     * <p>{@code paceSecPerKm = round(1000 / meanSpeedMps)}
     */
    public static Integer fromAverageSpeedMps(BigDecimal averageSpeedMps) {
        if (averageSpeedMps == null || averageSpeedMps.signum() <= 0) {
            return null;
        }
        double speed = averageSpeedMps.doubleValue();
        if (!Double.isFinite(speed) || speed <= 0d) {
            return null;
        }
        double pace = 1000.0d / speed;
        if (!Double.isFinite(pace) || pace <= 0d) {
            return null;
        }
        return (int) Math.round(pace);
    }
}
