package com.runway.backend.domain.session.dto.response;

import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import java.time.Instant;

/** G09가 승인한 개인 세션의 START 명령과 현재 결과. */
public record GroupStartCommand(
        long sessionId, long commandId, String result, long expectedVersion, Instant startedAt) {

    public static GroupStartCommand of(SessionControlEvent event, RunningSession session) {
        return new GroupStartCommand(
                session.getId(),
                event.getId(),
                event.getResult().name(),
                event.getExpectedVersion(),
                session.getStartedAt());
    }
}
