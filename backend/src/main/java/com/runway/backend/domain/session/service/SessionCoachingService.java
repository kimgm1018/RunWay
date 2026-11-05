package com.runway.backend.domain.session.service;

import com.runway.backend.domain.coaching.service.CoachingSupplier;
import com.runway.backend.domain.session.dto.request.SessionBpmRequest;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.PacePlan;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.RunningSessionStatus;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.repository.PacePlanRepository;
import com.runway.backend.domain.session.repository.SessionCoachingRepository;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.stream.SessionStreamChanged;
import com.runway.backend.global.exception.ApiException;

import lombok.RequiredArgsConstructor;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;

/**
 * 서버 내부 COACHING 발행(pace-coaching.md "코칭을 보내는 시점"). 실제 AI 판단 전 단계로, 새 측정 batch가 저장될 때마다 "코칭 없이 2분 경과"
 * 조건만 판단해 공급자의 추천을 COACHING 명령으로 승인한다.
 *
 * <p>적용되지 않은 코칭(REJECTED·IGNORED) 뒤에는 그 발행 시각부터 30초가 지나야 다시 보낸다. 폰의 S10 구독이 없는 세션은 호출자
 * ({@code CoachingTrigger})가 판단하지 않는다.
 *
 * <p>세션 잠금 아래에서 조건을 다시 확인하고 추천 저장·명령 승인을 한 트랜잭션으로 처리한다. 수동 제어·다른 코칭과는 세션 잠금, 요청 슬롯
 * (uq_control_version), 미확정 명령 1개(uq_control_pending)로 직렬화되어 한 번에 하나만 생긴다. 20초 입력 신선도 기반 추론은 후속 AI 연동
 * 범위다.
 */
@Service
@RequiredArgsConstructor
public class SessionCoachingService {

    /** 코칭 없이 다시 판단하는 간격. */
    static final Duration REEVALUATE_AFTER = Duration.ofMinutes(2);

    /**
     * 적용되지 않은 코칭(REJECTED·IGNORED) 뒤 다시 발행할 수 있는 최소 간격(S15P31E105-257 리뷰 R-1, 2026-11-05 확정). 같은 실패가 batch마다
     * 반복돼 사용자 조작을 막지 않게 한다.
     */
    static final Duration RETRY_AFTER_NOT_APPLIED = Duration.ofSeconds(30);

    /** 추천의 유효시간. 만료는 생성 후 20초를 넘지 않는다(ck_coaching_context). */
    static final Duration VALID_FOR = Duration.ofSeconds(20);

    private final SessionAccess access;
    private final SessionReferenceRepository referenceRepository;
    private final SessionCoachingRepository coachingRepository;
    private final SessionControlEventRepository controlEventRepository;
    private final PacePlanRepository pacePlanRepository;
    private final CoachingSupplier supplier;
    private final ApplicationEventPublisher events;

    /**
     * 조건을 만족하면 코칭 명령을 하나 승인한다.
     *
     * @return 승인한 명령. 조건을 만족하지 않으면 빈 값
     */
    @Transactional
    public Optional<SessionControlEvent> issueIfDue(long sessionId) {
        var ownership = referenceRepository.findOwnership(sessionId).orElse(null);
        if (ownership == null || ownership.deleted()) {
            return Optional.empty();
        }
        RunningSession session;
        try {
            session =
                    access.lockOwnedSession(
                                    ownership.userId(), sessionId, SessionAccess.LockPurpose.UPDATE)
                            .session();
        } catch (ApiException e) {
            // 탈퇴·삭제·잠금 사이 그룹 연결 변경 등. 다음 batch에서 다시 판단한다.
            return Optional.empty();
        }
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (!isDue(session, now)) {
            return Optional.empty();
        }

        BigDecimal planPace =
                pacePlanRepository
                        .findFirstBySessionIdOrderByIdDesc(sessionId)
                        .map(PacePlan::getRecommendedPace)
                        .orElse(null);
        CoachingSupplier.Proposal proposal =
                supplier.propose(
                        new CoachingSupplier.Input(sessionId, planPace, session.getCurrentBpm()));
        if (proposal == null
                || proposal.recommendedPaceSecPerKm() == null
                || proposal.recommendedPaceSecPerKm().signum() <= 0
                || proposal.targetBpm() < SessionBpmRequest.MIN_BPM
                || proposal.targetBpm() > SessionBpmRequest.MAX_BPM) {
            return Optional.empty();
        }

        long version = session.getStateVersion();
        int elapsed =
                (int) Math.max(0, Duration.between(session.getStartedAt(), now).toSeconds());
        long coachingId =
                coachingRepository.insertDecision(
                        sessionId,
                        elapsed,
                        proposal.recommendedPaceSecPerKm(),
                        proposal.targetBpm(),
                        version,
                        now,
                        now.plus(VALID_FOR));
        SessionControlEvent command =
                controlEventRepository.saveAndFlush(
                        SessionControlEvent.bpmRequest(
                                sessionId,
                                session.getControlDeviceId(),
                                ControlAction.COACHING,
                                version,
                                proposal.targetBpm(),
                                coachingId,
                                now));
        events.publishEvent(SessionStreamChanged.coaching(sessionId));
        return Optional.of(command);
    }

    /**
     * 발행 전제: 워치로 기록 중인 RUNNING, 건강정보 동의, 그룹 미종료, 현재 제어기기의 미확정 명령 없음, 같은 요청 슬롯 미사용, 마지막 실제 시작·재개·코칭
     * 적용 후 2분 경과.
     */
    private boolean isDue(RunningSession session, Instant now) {
        if (session.getStatus() != RunningSessionStatus.RUNNING
                || session.getStateVersion() < 1
                || session.getStartedAt() == null
                || session.getControlDeviceId() == null
                || session.isPhoneFallback()) {
            return false;
        }
        if (!coachingRepository.healthConsented(session.getUserId())) {
            return false;
        }
        if (access.groupEndedAt(session.getId()).isPresent()) {
            return false;
        }
        if (access.pendingCommand(session) != null
                || controlEventRepository
                        .findBySessionIdAndExpectedVersion(session.getId(), session.getStateVersion())
                        .isPresent()) {
            return false;
        }
        Instant base = session.getStartedAt();
        Optional<Instant> lastApplied =
                coachingRepository.lastAppliedResumeOrCoaching(session.getId());
        if (lastApplied.isPresent() && lastApplied.get().isAfter(base)) {
            base = lastApplied.get();
        }
        if (now.isBefore(base.plus(REEVALUATE_AFTER))) {
            return false;
        }
        // 마지막 코칭이 적용되지 않았다면 그 발행 뒤 30초가 지나야 다시 보낸다.
        var lastCoaching = coachingRepository.lastCoaching(session.getId());
        return lastCoaching.isEmpty()
                || lastCoaching.get().applied()
                || !now.isBefore(lastCoaching.get().issuedAt().plus(RETRY_AFTER_NOT_APPLIED));
    }
}
