package com.runway.backend.domain.course.elevation;

/** WGS84 경위도로 고도(m)를 조회한다. 측정 범위 밖·NoData는 NaN이며 호출자는 보간한다. */
@FunctionalInterface
public interface ElevationSource {
    double elevationAt(double longitude, double latitude);
}
