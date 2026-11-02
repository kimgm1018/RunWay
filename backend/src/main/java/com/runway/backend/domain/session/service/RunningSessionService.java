package com.runway.backend.domain.session.service;

import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.session.dto.request.CreateRunningSessionRequest;
import com.runway.backend.domain.session.dto.request.UpdateRunningSessionRequest;
import com.runway.backend.domain.session.dto.response.DeletedSessionResponse;
import com.runway.backend.domain.session.dto.response.PreparedResponse;
import com.runway.backend.domain.session.dto.response.RunningSessionResponse;
import com.runway.backend.domain.session.entity.AnalysisStatus;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.PacePlan;
import com.runway.backend.domain.session.entity.PacePlanSegment;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.RunningSessionStatus;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.mapper.RunningSessionMapper;
import com.runway.backend.domain.session.mapper.SessionSnapshot;
import com.runway.backend.domain.session.repository.PacePlanRepository;
import com.runway.backend.domain.session.repository.PacePlanSegmentRepository;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.CourseInfo;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.DeviceRef;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.PostRef;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.SessionOwnership;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * S01·S02·S08·S09. 상태를 바꾸는 요청은 (그룹 행 →) 세션 행 순서로 잠근 뒤 소유·상태·버전을 다시 검사한다.
 *
 * 잠금 순서: 생성은 기기·코스(FOR SHARE) → 회원 advisory lock → 비교 대상 세션(FOR SHARE). 변경·삭제는 그룹런(FOR NO KEY
 * UPDATE) → 세션 → (기기·코스·비교 대상 세션 FOR SHARE | 게시물 ID순). 기기 해제(W03)와 코스 상태 변경은 해당 행만 갱신하므로 교차 대기가 없다. 비교 대상은 COMPLETED이고 변경 대상은 READY이므로 두 세션이 서로를 잠그며 기다리는 순서는 생기지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RunningSessionService {

    private static final Set<ControlResult> UNCONFIRMED =
            EnumSet.of(ControlResult.PENDING, ControlResult.UNKNOWN);
    /** 목표 거리 상한(m). 풀코스 마라톤(42.195km)을 포함하는 45km. */
    static final int MAX_TARGET_DISTANCE_M = 45_000;

    private static final Set<AnalysisStatus> ANALYSIS_SETTLED =
            EnumSet.of(AnalysisStatus.READY, AnalysisStatus.FAILED, AnalysisStatus.LEGACY);

    private final RunningSessionRepository sessionRepository;
    private final PacePlanRepository pacePlanRepository;
    private final PacePlanSegmentRepository segmentRepository;
    private final SessionControlEventRepository controlEventRepository;
    private final SessionReferenceRepository referenceRepository;
    private final SegmentDifficultyProvider segmentDifficultyProvider;

    /**
     * S01. 응답 유실 후 재요청은 새 세션을 만들지 않고 409 ACTIVE_SESSION_EXISTS로 본인 활성 세션 ID를 알려준다.
     *
     * <p>활성 세션 검사는 회원 잠금 뒤 새 스냅샷을 읽어야 하므로 READ COMMITTED를 명시한다(REPEATABLE READ면 잠금 전
     * 스냅샷이 고정돼 동시 생성이 모두 통과한다). 세션을 만드는 다른 경로도 같은 회원 잠금을 쓰며, 잠금을 놓친 경로는 부분
     * UNIQUE uq_running_sessions_active(V8)가 막는다.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public RunningSessionResponse create(
            long userId, CreateRunningSessionRequest request, Instant serverReceiveAt) {
        requireActiveUser(userId);
        requireOwnedDevice(userId, request.controlDeviceId(), DeviceType.WATCH);
        requireOwnedDevice(userId, request.relayDeviceId(), DeviceType.PHONE);
        SessionGoal goal = request.goal();
        validateTargets(goal);
        CourseInfo course = requireUsableCourse(goal.courseId());

        referenceRepository.lockSessionCreation(userId);
        validateComparison(userId, goal);
        sessionRepository
                .findActiveSessionId(userId)
                .ifPresent(
                        activeId -> {
                            throw SessionErrors.activeSessionExists(activeId);
                        });

        var draft =
                InitialPacePlanCalculator.calculate(
                        goal, course == null ? null : course.distanceM(), segmentDifficultyProvider);
        Instant now = now();
        RunningSession session =
                sessionRepository.saveAndFlush(
                        RunningSession.ready(
                                userId,
                                request.controlDeviceId(),
                                request.relayDeviceId(),
                                goal,
                                now));
        draft.ifPresent(plan -> savePlan(session.getId(), plan, now));
        return response(session, serverReceiveAt);
    }

    /** S02. 상태·계획·명령을 한 스냅샷에서 읽기 위해 REPEATABLE READ로 조회한다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public RunningSessionResponse get(long userId, long sessionId, Instant serverReceiveAt) {
        requireActiveUser(userId);
        RunningSession session =
                sessionRepository.findById(sessionId).orElseThrow(SessionErrors::sessionNotFound);
        if (session.isDeleted()) {
            throw SessionErrors.sessionNotFound();
        }
        if (session.getUserId() != userId) {
            throw SessionErrors.sessionForbidden();
        }
        return response(session, serverReceiveAt);
    }

    /** S08 UPDATE_GOAL / TAKE_OVER_PHONE / ABORT_UNCONFIRMED_START. 변경 후 전체 상태를 반환한다. */
    @Transactional
    public RunningSessionResponse update(
            long userId,
            long sessionId,
            UpdateRunningSessionRequest request,
            Instant serverReceiveAt) {
        LockedSession locked = lockOwnedSession(userId, sessionId, false);
        RunningSession session = locked.session();
        switch (request.operation()) {
            case UPDATE_GOAL -> updateGoal(userId, locked, request);
            case TAKE_OVER_PHONE -> takeOverPhone(userId, session, request);
            case ABORT_UNCONFIRMED_START -> abortUnconfirmedStart(userId, session, request);
            case REPORT_PREPARED ->
                    throw new IllegalArgumentException("REPORT_PREPARED는 reportPrepared로 처리한다.");
        }
        sessionRepository.flush();
        return response(session, serverReceiveAt);
    }

    /** S08 REPORT_PREPARED. 별도 준비 장부를 두지 않으며 DB를 바꾸지 않는다. */
    @Transactional(readOnly = true)
    public PreparedResponse reportPrepared(
            long userId, long sessionId, UpdateRunningSessionRequest request) {
        requireActiveUser(userId);
        RunningSession session =
                sessionRepository.findById(sessionId).orElseThrow(SessionErrors::sessionNotFound);
        if (session.isDeleted()) {
            throw SessionErrors.sessionNotFound();
        }
        if (session.getUserId() != userId) {
            throw SessionErrors.sessionForbidden();
        }
        if (!request.deviceId().equals(session.getControlDeviceId())
                || session.isPhoneFallback()) {
            throw SessionErrors.deviceForbidden();
        }
        requireOwnedDevice(
                userId, referenceRepository.findDevice(request.deviceId()), DeviceType.WATCH);
        if (session.getStatus() != RunningSessionStatus.READY) {
            throw SessionErrors.invalidSessionState();
        }
        if (session.getStateVersion() != request.expectedVersion()) {
            throw SessionErrors.staleState();
        }
        return new PreparedResponse(request.expectedVersion());
    }

    /** S09. 세션과 본인 연결 게시물을 같은 시각으로 삭제 표시한다. 하나라도 실패하면 모두 롤백한다. */
    @Transactional
    public DeletedSessionResponse delete(long userId, long sessionId) {
        LockedSession locked = lockOwnedSession(userId, sessionId, true);
        RunningSession session = locked.session();
        requireDeletable(session);
        if (locked.groupRunId() != null) {
            if (!locked.groupCompleted()
                    || !referenceRepository.groupAnalysisSettled(locked.groupRunId())) {
                throw SessionErrors.invalidDeleteState();
            }
        }

        List<PostRef> posts = referenceRepository.lockPostsOfSession(sessionId);
        if (posts.stream().anyMatch(post -> post.authorId() != userId)) {
            log.error("다른 회원의 게시물이 러닝 세션을 참조해 삭제를 중단함. sessionId={}", sessionId);
            throw SessionErrors.integrityViolation();
        }
        Instant deletedAt = now();
        session.markDeleted(deletedAt);
        sessionRepository.flush();
        referenceRepository.markPostsDeleted(sessionId, userId, deletedAt);
        return new DeletedSessionResponse(sessionId, deletedAt);
    }

    private void updateGoal(long userId, LockedSession locked, UpdateRunningSessionRequest request) {
        RunningSession session = locked.session();
        SessionGoal goal = request.goalPatch().applyTo(session.goal());
        if (goal.sameAs(session.goal())) {
            return;
        }
        if (session.getStatus() != RunningSessionStatus.READY || locked.groupRunId() != null) {
            throw SessionErrors.invalidSessionState();
        }
        if (pendingCommand(session) != null) {
            throw SessionErrors.commandPending();
        }
        if (session.getStateVersion() != request.expectedVersion()) {
            throw SessionErrors.staleState();
        }
        validateTargets(goal);
        CourseInfo course = requireUsableCourse(goal.courseId());
        // 비교 대상·코스가 그대로면 기존 참조를 보존한다(S09 삭제 후 참조 규칙). 새 조합만 다시 검사한다.
        SessionGoal current = session.goal();
        if (!Objects.equals(goal.comparisonSessionId(), current.comparisonSessionId())
                || !Objects.equals(goal.courseId(), current.courseId())) {
            validateComparison(userId, goal);
        }

        var draft =
                InitialPacePlanCalculator.calculate(
                        goal, course == null ? null : course.distanceM(), segmentDifficultyProvider);
        Instant now = now();
        pacePlanRepository.deleteSegmentsBySessionId(session.getId());
        pacePlanRepository.deletePlansBySessionId(session.getId());
        session.changeGoal(goal, now);
        draft.ifPresent(plan -> savePlan(session.getId(), plan, now));
    }

    /** 이미 같은 폰으로 인계된 요청은 종료 여부와 무관하게 현재 상태를 반환한다. */
    private void takeOverPhone(
            long userId, RunningSession session, UpdateRunningSessionRequest request) {
        requireRelayPhone(userId, session, request.deviceId());
        if (session.isPhoneFallback()) {
            return;
        }
        if (!request.receivedWatchBatchesUploaded()) {
            throw SessionErrors.uploadPending();
        }
        boolean started =
                session.getStartedAt() != null
                        && (session.getStatus() == RunningSessionStatus.RUNNING
                                || session.getStatus() == RunningSessionStatus.PAUSED);
        if (!started || session.getStateVersion() < 1 || session.getControlDeviceId() == null) {
            throw SessionErrors.invalidSessionState();
        }
        if (session.getStateVersion() != request.expectedVersion()) {
            throw SessionErrors.staleState();
        }
        controlEventRepository
                .findFirstBySessionIdAndDeviceIdAndResultIn(
                        session.getId(), session.getControlDeviceId(), UNCONFIRMED)
                .ifPresent(
                        event -> event.markUnknownIfPending(SessionControlEvent.WATCH_DISCONNECTED));
        session.takeOverByRelayPhone(now());
    }

    /** 같은 폰의 재요청은 버전 검사보다 먼저 이미 중단된 동일 세션인지 확인한다. */
    private void abortUnconfirmedStart(
            long userId, RunningSession session, UpdateRunningSessionRequest request) {
        requireAbortingPhone(userId, session, request.deviceId());
        if (isAbortedUnconfirmedStart(session)) {
            return;
        }
        SessionControlEvent pending = pendingCommand(session);
        if (session.getStatus() != RunningSessionStatus.READY
                || session.getStartedAt() != null
                || pending == null
                || pending.getAction() != ControlAction.START) {
            throw SessionErrors.invalidSessionState();
        }
        if (session.getStateVersion() != request.expectedVersion()) {
            throw SessionErrors.staleState();
        }
        pending.markUnknownIfPending(SessionControlEvent.START_UNCONFIRMED_ABORTED);
        session.abortUnconfirmedStart(now());
    }

    private boolean isAbortedUnconfirmedStart(RunningSession session) {
        return session.getStatus() == RunningSessionStatus.INTERRUPTED
                && session.getStartedAt() == null
                && session.getEndedAt() == null
                && controlEventRepository.existsBySessionIdAndActionAndResultIn(
                        session.getId(), ControlAction.START, UNCONFIRMED);
    }

    private void requireDeletable(RunningSession session) {
        boolean allowed =
                switch (session.getStatus()) {
                    case CANCELLED -> pendingCommand(session) == null;
                    case COMPLETED ->
                            ANALYSIS_SETTLED.contains(session.getAnalysisStatus())
                                    && pendingCommand(session) == null;
                    // 관리상 중단 후 보존한 UNKNOWN은 현재 미확정 명령으로 보지 않는다.
                    case INTERRUPTED -> !hasPendingResult(session);
                    case READY, RUNNING, PAUSED -> false;
                };
        if (!allowed) {
            throw SessionErrors.invalidDeleteState();
        }
    }

    /**
     * 그룹 연결 세션은 그룹 행을 먼저 잠근다. 잠금 전 확인과 잠금 후 재확인 사이에 삭제·소유 정보가 바뀌었을 수 있으므로 잠근 행으로 다시 판정한다.
     * 그 사이 그룹 연결이 바뀌었으면 잠근 그룹 행이 맞지 않으므로 S08은 409 STALE_STATE, S09는 409 INVALID_STATE로 거절하고 재조회하게 한다.
     * 세션 행 잠금(PESSIMISTIC_WRITE)은 PostgreSQL에서 FOR NO KEY UPDATE라 FK 검사를 막지 않는다. 이 재확인은 연결을 저장하는 쪽도
     * group-runs.md "그룹 세션 연결의 불변조건"대로 그룹→세션 행을 잠근 뒤 저장한다는 전제에서 유효하다.
     */
    private LockedSession lockOwnedSession(long userId, long sessionId, boolean forDelete) {
        requireActiveUser(userId);
        SessionOwnership ownership =
                referenceRepository
                        .findOwnership(sessionId)
                        .orElseThrow(SessionErrors::sessionNotFound);
        if (ownership.deleted()) {
            throw SessionErrors.sessionNotFound();
        }
        if (ownership.userId() != userId) {
            throw forDelete ? SessionErrors.notOwner() : SessionErrors.sessionForbidden();
        }
        boolean groupCompleted = false;
        if (ownership.groupRunId() != null) {
            groupCompleted =
                    referenceRepository
                            .lockGroupRun(ownership.groupRunId())
                            .map(SessionReferenceRepository.GroupRunState::isCompleted)
                            .orElse(false);
        }
        RunningSession session =
                sessionRepository
                        .findByIdForUpdate(sessionId)
                        .orElseThrow(SessionErrors::sessionNotFound);
        if (session.isDeleted()) {
            throw SessionErrors.sessionNotFound();
        }
        if (session.getUserId() != userId) {
            throw forDelete ? SessionErrors.notOwner() : SessionErrors.sessionForbidden();
        }
        Long groupRunId = referenceRepository.findGroupRunId(sessionId).orElse(null);
        if (!Objects.equals(groupRunId, ownership.groupRunId())) {
            throw forDelete ? SessionErrors.invalidDeleteState() : SessionErrors.staleState();
        }
        return new LockedSession(session, ownership.groupRunId(), groupCompleted);
    }

    /**
     * 시작 미확인 중단은 세션의 중계 폰이 요청한다. 중계 폰이 연결 해제됐으면(재설치 후 새 ID 등록 등) 세션을 정리할 다른 방법이 없으므로 본인의
     * 현재 연결된 다른 폰도 허용한다. 중계 폰이 연결 중이면 그 폰만 허용한다. 세션의 relayDeviceId는 바꾸지 않는다.
     */
    private void requireAbortingPhone(long userId, RunningSession session, long deviceId) {
        Long relayDeviceId = session.getRelayDeviceId();
        if (relayDeviceId == null) {
            throw SessionErrors.deviceForbidden();
        }
        if (relayDeviceId != deviceId) {
            boolean relayLinked =
                    referenceRepository
                            .lockDevice(relayDeviceId)
                            .map(DeviceRef::linked)
                            .orElse(false);
            if (relayLinked) {
                throw SessionErrors.deviceForbidden();
            }
        }
        requireOwnedDevice(userId, deviceId, DeviceType.PHONE);
    }

    private void requireRelayPhone(long userId, RunningSession session, long deviceId) {
        if (session.getRelayDeviceId() == null || session.getRelayDeviceId() != deviceId) {
            throw SessionErrors.deviceForbidden();
        }
        requireOwnedDevice(userId, deviceId, DeviceType.PHONE);
    }

    /** 기기 행을 잠가 확인하므로 W03 해제와 겹쳐도 해제된 기기로 세션을 저장하지 않는다. */
    private void requireOwnedDevice(long userId, long deviceId, DeviceType type) {
        requireOwnedDevice(userId, referenceRepository.lockDevice(deviceId), type);
    }

    private static void requireOwnedDevice(long userId, Optional<DeviceRef> found, DeviceType type) {
        DeviceRef device = found.orElseThrow(SessionErrors::deviceForbidden);
        if (device.userId() != userId || !type.name().equals(device.deviceType()) || !device.linked()) {
            throw SessionErrors.deviceForbidden();
        }
    }

    private void requireActiveUser(long userId) {
        if (!referenceRepository.activeUserExists(userId)) {
            throw SessionErrors.unauthorized();
        }
    }

    /** 거리·시간·페이스는 양수이며 최대 2개까지 지정한다. 목표 거리는 45km 이하다. */
    private static void validateTargets(SessionGoal goal) {
        if (isNotPositive(goal.distanceM())
                || (goal.distanceM() != null && goal.distanceM() > MAX_TARGET_DISTANCE_M)
                || isNotPositive(goal.durationSec())
                || (goal.paceSecPerKm() != null && goal.paceSecPerKm().signum() <= 0)
                || goal.targetCount() > 2) {
            throw SessionErrors.invalidGoal();
        }
    }

    private static boolean isNotPositive(Integer value) {
        return value != null && value <= 0;
    }

    private CourseInfo requireUsableCourse(Long courseId) {
        if (courseId == null) {
            return null;
        }
        CourseInfo course =
                referenceRepository.lockCourse(courseId).orElseThrow(SessionErrors::courseNotFound);
        if (!course.isActive()) {
            throw SessionErrors.courseInaccessible();
        }
        return course;
    }

    /** 자유러닝에는 비교 모드가 없다. 비교 기록은 본인·미삭제·COMPLETED·같은 코스여야 한다. */
    private void validateComparison(long userId, SessionGoal goal) {
        if (goal.comparisonSessionId() == null) {
            return;
        }
        if (goal.courseId() == null) {
            throw SessionErrors.invalidComparisonSession();
        }
        boolean valid =
                referenceRepository
                        .lockComparisonCandidate(userId, goal.comparisonSessionId())
                        .filter(c -> !c.deleted())
                        .filter(c -> RunningSessionStatus.COMPLETED.name().equals(c.status()))
                        .filter(c -> goal.courseId().equals(c.courseId()))
                        .isPresent();
        if (!valid) {
            throw SessionErrors.invalidComparisonSession();
        }
    }

    private void savePlan(long sessionId, InitialPacePlanCalculator.PlanDraft draft, Instant now) {
        PacePlan plan = pacePlanRepository.save(PacePlan.of(sessionId, draft.paceSecPerKm(), now));
        int sequence = 1;
        for (InitialPacePlanCalculator.SegmentDraft segment : draft.segments()) {
            segmentRepository.save(
                    PacePlanSegment.of(
                            plan.getId(),
                            sequence++,
                            segment.startDistanceM(),
                            segment.endDistanceM(),
                            segment.paceSecPerKm(),
                            now));
        }
    }

    /** 현재 제어기기의 PENDING/UNKNOWN 명령. 관리상 중단한 세션은 없다. */
    private SessionControlEvent pendingCommand(RunningSession session) {
        if (session.getStatus() == RunningSessionStatus.INTERRUPTED
                || session.getControlDeviceId() == null) {
            return null;
        }
        return controlEventRepository
                .findFirstBySessionIdAndDeviceIdAndResultIn(
                        session.getId(), session.getControlDeviceId(), UNCONFIRMED)
                .orElse(null);
    }

    private boolean hasPendingResult(RunningSession session) {
        return session.getControlDeviceId() != null
                && controlEventRepository
                        .findFirstBySessionIdAndDeviceIdAndResultIn(
                                session.getId(),
                                session.getControlDeviceId(),
                                EnumSet.of(ControlResult.PENDING))
                        .isPresent();
    }

    private RunningSessionResponse response(RunningSession session, Instant serverReceiveAt) {
        PacePlan plan = pacePlanRepository.findFirstBySessionIdOrderByIdDesc(session.getId()).orElse(null);
        List<PacePlanSegment> segments =
                plan == null
                        ? List.of()
                        : segmentRepository.findByPacePlanIdOrderBySegmentSequenceAsc(plan.getId());
        SessionControlEvent pending = pendingCommand(session);
        var coachingGuide =
                pending != null && pending.getCoachingId() != null
                        ? referenceRepository
                                .findCoachingGuide(session.getId(), pending.getCoachingId())
                                .orElse(null)
                        : null;
        SessionControlEvent last =
                controlEventRepository.findFirstBySessionIdOrderByIdDesc(session.getId()).orElse(null);
        Instant groupEndedAt = referenceRepository.findGroupEndedAt(session.getId()).orElse(null);
        SessionSnapshot snapshot =
                new SessionSnapshot(session, plan, segments, pending, coachingGuide, last, groupEndedAt);
        return RunningSessionMapper.toResponse(snapshot, serverReceiveAt, Instant.now());
    }

    /** PostgreSQL TIMESTAMPTZ는 마이크로초까지 저장하므로 응답과 DB 값이 같도록 자른다. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    private record LockedSession(
            RunningSession session, Long groupRunId, boolean groupCompleted) {}
}
