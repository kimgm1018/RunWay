package com.runway.backend.domain.runningrecord.dto.response;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * H09 공유 기록 조회. 로그인 없이 보는 표시용 요약과 경로만 담는다. 심박·목표·기기·세션 ID·경로 출처는 넣지 않는다. segments는 S11과
 * 같은 경로 선택 규칙으로 고른 [경도, 위도] 조각이다.
 */
public record SharedRunResponse(
        String title,
        Instant startedAt,
        BigDecimal distanceM,
        Integer durationSec,
        BigDecimal averagePaceSecPerKm,
        BigDecimal cadence,
        Runner runner,
        List<Segment> segments) {

    public record Runner(
            String nickname, @JsonInclude(JsonInclude.Include.ALWAYS) String profileImageUrl) {}

    public record Segment(List<double[]> coordinates) {}
}
