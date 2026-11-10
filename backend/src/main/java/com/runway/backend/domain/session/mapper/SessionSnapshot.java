package com.runway.backend.domain.session.mapper;

import com.runway.backend.domain.session.dto.response.RunningSessionResponse;
import com.runway.backend.domain.session.entity.PacePlan;
import com.runway.backend.domain.session.entity.PacePlanSegment;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.CoachingGuideRow;

import java.time.Instant;
import java.util.List;

/** 한 트랜잭션에서 읽은 S02 응답 재료. 없을 수 있는 값은 null이다. */
public record SessionSnapshot(
        RunningSession session,
        PacePlan plan,
        List<PacePlanSegment> segments,
        SessionControlEvent pendingCommand,
        CoachingGuideRow coachingGuide,
        SessionControlEvent lastCommand,
        Instant groupEndedAt,
        RunningSessionResponse.RecordComparison comparison,
        Integer movingDurationSec) {

    public SessionSnapshot {
        segments = List.copyOf(segments);
    }
}
