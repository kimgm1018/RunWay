package com.runway.backend.domain.session.mapper;

import com.runway.backend.domain.session.dto.response.RunningSessionResponse;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.PacePlan;
import com.runway.backend.domain.session.entity.PacePlanSegment;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.CoachingGuideRow;
import java.time.Instant;
import java.util.List;

/** 세션·계획·명령·그룹 조회 결과를 S02 응답으로 조립한다. 조회는 Service에서 끝낸다. */
public final class RunningSessionMapper {

    private RunningSessionMapper() {}

    public static RunningSessionResponse toResponse(
            SessionSnapshot snapshot, Instant serverReceiveAt, Instant serverSendAt) {
        RunningSession session = snapshot.session();
        return new RunningSessionResponse(
                session.getId(),
                session.getControlDeviceId(),
                session.getRelayDeviceId(),
                session.getStatus().name(),
                session.getStateVersion(),
                session.getCurrentBpm(),
                session.getStartedAt(),
                session.getEndedAt(),
                new RunningSessionResponse.Goal(
                        session.getCourseId(),
                        session.getComparisonSessionId(),
                        session.getGoalDistance(),
                        session.getGoalDuration(),
                        session.getGoalPace()),
                plan(snapshot.plan(), snapshot.segments()),
                new RunningSessionResponse.Analysis(session.getAnalysisStatus().name()),
                null,
                command(snapshot.pendingCommand(), snapshot.coachingGuide()),
                command(snapshot.lastCommand(), lastCommandGuide(snapshot)),
                serverReceiveAt,
                serverSendAt,
                recordingMode(session),
                snapshot.groupEndedAt());
    }

    /** 마지막 명령이 현재 제어기기의 미확정 명령(pendingCommand)과 같으면 같은 코칭 가이드를 보여준다. */
    private static CoachingGuideRow lastCommandGuide(SessionSnapshot snapshot) {
        SessionControlEvent pending = snapshot.pendingCommand();
        SessionControlEvent last = snapshot.lastCommand();
        if (pending == null || last == null || !pending.getId().equals(last.getId())) {
            return null;
        }
        return snapshot.coachingGuide();
    }

    /** 기기 정보가 없는 기존 기록은 null이며 폰 전환으로 판단하지 않는다. */
    private static String recordingMode(RunningSession session) {
        if (session.getControlDeviceId() == null) {
            return null;
        }
        return session.isPhoneFallback() ? "PHONE_FALLBACK" : "WATCH";
    }

    private static RunningSessionResponse.Plan plan(
            PacePlan plan, List<PacePlanSegment> segments) {
        if (plan == null) {
            return null;
        }
        return new RunningSessionResponse.Plan(
                plan.getId(),
                plan.getRecommendedPace(),
                segments.stream()
                        .map(
                                segment ->
                                        new RunningSessionResponse.Segment(
                                                segment.getSegmentSequence(),
                                                segment.getStartDistance(),
                                                segment.getEndDistance(),
                                                segment.getRecommendedPace()))
                        .toList());
    }

    private static RunningSessionResponse.Command command(
            SessionControlEvent event, CoachingGuideRow guide) {
        if (event == null) {
            return null;
        }
        RunningSessionResponse.CoachingGuide coachingGuide = null;
        if (guide != null
                && event.getAction() == ControlAction.COACHING
                && event.isUnconfirmed()) {
            coachingGuide =
                    new RunningSessionResponse.CoachingGuide(
                            event.getId(),
                            event.getCoachingId(),
                            event.getExpectedVersion(),
                            event.getTargetBpm(),
                            guide.recommendedPace(),
                            guide.expiresAt());
        }
        return new RunningSessionResponse.Command(
                event.getId(),
                event.getAction().name(),
                event.getTargetBpm(),
                event.getExpectedVersion(),
                event.getCoachingId(),
                event.getResult().name(),
                event.getAppliedAt(),
                event.getReasonCode(),
                coachingGuide);
    }
}
