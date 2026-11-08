package com.runway.backend.domain.user.personalization;

import java.time.Instant;

/**
 * {@code running_route_points} 한 행. 기기가 없으면({@code device_id IS NULL}) {@link DeviceType#PHONE}이다.
 *
 * @param measuredAt {@code measured_at}
 * @param longitude 경도(WGS84)
 * @param latitude 위도(WGS84)
 * @param deviceType 점을 보낸 기기 종류
 */
public record W07RoutePoint(
        Instant measuredAt, double longitude, double latitude, DeviceType deviceType) {

    /** {@code user_devices.device_type}. */
    public enum DeviceType {
        WATCH,
        PHONE;

        /** null이나 알 수 없는 값은 PHONE으로 본다(w07-ai06-conversion.md 2절). */
        public static DeviceType fromDb(String value) {
            return "WATCH".equals(value) ? WATCH : PHONE;
        }
    }

    @Override
    public String toString() {
        return "W07RoutePoint[REDACTED]";
    }
}
