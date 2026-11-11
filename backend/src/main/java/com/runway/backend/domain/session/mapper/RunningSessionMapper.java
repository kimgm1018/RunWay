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
                snapshot.movingDurationSec(),
                new RunningSessionResponse.Goal(
                        session.getCourseId(),
                        session.getComparisonSessionId(),
                        session.getGoalDistance(),
                        session.getGoalDuration(),
                        session.getGoalPace()),
                plan(snapshot.plan(), snapshot.segments()),
                new RunningSessionResponse.Analysis(session.getAnalysisStatus().name()),
                coaching(snapshot, serverSendAt),
                snapshot.comparison(),
                command(snapshot.pendingCommand(), snapshot.coachingGuide()),
                command(snapshot.lastCommand(), lastCommandGuide(snapshot)),
                serverReceiveAt,
                serverSendAt,
                recordingMode(session),
                snapshot.groupEndedAt(),
                snapshot.rhythmCueEnabled());
    }

    /**
     * 현재 유효한 최신 코칭. 현재 제어기기의 미확정 COACHING 명령이 있고 그 추천의 기준 버전이 현재 버전이며 만료 전일 때만 채운다(sessions.md
     * coaching 객체). 만료 뒤에는 null이며 결과 확인은 pendingCommand.coachingGuide로 한다.
     */
    private static RunningSessionResponse.CoachingGuide coaching(
            SessionSnapshot snapshot, Instant now) {
        SessionControlEvent pending = snapshot.pendingCommand();
        CoachingGuideRow guide = snapshot.coachingGuide();
        if (pending == null
                || guide == null
                || pending.getAction() != ControlAction.COACHING
                || !pending.isUnconfirmed()
                || guide.expiresAt() == null
                || !now.isBefore(guide.expiresAt())
                || pending.getExpectedVersion() != snapshot.session().getStateVersion()) {
            return null;
        }
        return guide(pending, guide);
    }

    private static RunningSessionResponse.CoachingGuide guide(
            SessionControlEvent event, CoachingGuideRow guide) {
        return new RunningSessionResponse.CoachingGuide(
                event.getId(),
                event.getCoachingId(),
                event.getExpectedVersion(),
                event.getTargetBpm(),
                guide.recommendedPace(),
                guide.expiresAt(),
                guide.coachingLevel());
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
            coachingGuide = guide(event, guide);
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
