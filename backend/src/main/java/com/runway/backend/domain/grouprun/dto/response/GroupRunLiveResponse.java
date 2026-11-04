package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;
import java.util.List;

/** G10 실시간 현황 스텁. 순위·격차·안내 페이스는 아직 계약이 확정되지 않아 내려주지 않는다. */
public record GroupRunLiveResponse(
        long groupRunId,
        String status,
        Long courseId,
        Instant updatedAt,
        List<Participant> participants) {

    public record Participant(long userId) {}
}
