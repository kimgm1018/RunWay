package com.runway.backend.domain.course.recommend;

import com.runway.backend.domain.course.elevation.ElevationSource;

/**
 * 개발용 스텁 모드에서 DEM이 없을 때만 쓰는 합성 고도. 평지(0%)가 아닌 완만한 기복을 만들어 화면 확인에 쓴다.
 * 운영 HTTP 모드에는 주입하지 않는다(S15P31E105-423 D-5).
 */
public final class StubElevationSource implements ElevationSource {

    @Override
    public double elevationAt(double longitude, double latitude) {
        // 약 1km 주기의 기복(진폭 6m)을 위경도 양쪽에 둔다.
        return 20d + 6d * Math.sin(latitude * 700d) + 6d * Math.cos(longitude * 600d);
    }
}
