package com.runway.backend.domain.grouprun.dto.response;

import java.time.Instant;
import java.util.List;

/** G09 응답. 참가자별 START 명령(session_control_events.id)과 현재 결과. */
public record StartGroupRunResponse(List<Item> participants) {

    public record Item(
            long sessionId, long commandId, String result, long expectedVersion, Instant startedAt) {}
}
