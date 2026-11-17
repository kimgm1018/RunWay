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
import com.runway.backend.domain.session.repository.PacePlanRepository;
import com.runway.backend.domain.session.repository.PacePlanSegmentRepository;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.CourseInfo;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.DeviceRef;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.PostRef;
import com.runway.backend.domain.session.stream.SessionStreamChanged;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * S01·S02·S08·S09. 상태를 바꾸는 요청은 (그룹 행 →) 세션 행 순서로 잠근 뒤 소유·상태·버전을 다시 검사한다.
 *
 * <p>잠금 순서: 생성은 기기·코스(FOR SHARE) → 회원 advisory lock → 비교 대상 세션(FOR SHARE). 변경·삭제는 그룹런(FOR NO KEY
 * UPDATE) → 세션 → (기기·코스·비교 대상 세션 FOR SHARE | 게시물 ID순). 기기 해제(W03)와 코스 상태 변경은 해당 행만 갱신하므로 교차 대기가 없다.
 * 비교 대상은 COMPLETED이고 변경 대상은 READY이므로 두 세션이 서로를 잠그며 기다리는 순서는 생기지 않는다. W07 배치 저장(SyncBatchService)도
 * 세션 → 기기(FOR SHARE) 순서로 잠그며 회원 행은 잠그지 않는다. W04 동의 철회(ConsentService)는 회원 advisory lock → 회원 행
 * UPDATE → 본인 진행 가능 세션 FOR SHARE 순서로 잠근다. 따라서 세션 행이나 회원 advisory lock을 잡은 뒤에는 회원 행을 잠그지 않는다(FOR
 * SHARE 포함). 동의 확인이 필요하면 잠그지 않고 읽는다. 어기면 철회와 교착한다.
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
    private final SessionPlanPreparation planPreparation;
    private final PlatformTransactionManager transactionManager;
    private final SessionAccess access;
    private final ApplicationEventPublisher events;

    /**
     * S01. 응답 유실 후 재요청은 새 세션을 만들지 않고 409 ACTIVE_SESSION_EXISTS로 본인 활성 세션 ID를 알려준다.
     *
     * <p>활성 세션 검사는 회원 잠금 뒤 새 스냅샷을 읽어야 하므로 READ COMMITTED를 명시한다(REPEATABLE READ면 잠금 전 스냅샷이 고정돼 동시
     * 생성이 모두 통과한다). 세션을 만드는 다른 경로도 같은 회원 잠금을 쓰며, 잠금을 놓친 경로는 부분 UNIQUE
     * uq_running_sessions_active(V8)가 막는다.
     *
     * <p>이 메서드에는 트랜잭션 선언을 두지 않는다(S15P31E105-822). 사전 조회·계획 준비는 트랜잭션 범위 밖에서 조회마다 커넥션을 빌렸다 바로
     * 반납한다. {@code @Transactional(NOT_SUPPORTED)}를 두면 빈 트랜잭션 동기화 범위가 열린다. JDBC 커넥션은 저장 트랜잭션을 시작할 때 반납되지만,
     * 동기화 범위에 묶인 EntityManager 커넥션은 쥔 채 저장용 커넥션을 또 기다린다. 동시 요청이 풀 크기를 넘으면 서로 기다리다 모두 커넥션 대기
     * 시간초과(503)로 끝난다.
     *
     * <p>호출자 트랜잭션 안에서 부르면 맨 앞에서 {@link IllegalStateException}으로 거절한다. AI 계획 호출(AI09 개인 계획 최대 40초, 재시도
     * 포함, AiPersonalPacePlanConfig)을 DB 트랜잭션 안에서 하지 않기 위해서다.
     */
    public RunningSessionResponse create(
            long userId, CreateRunningSessionRequest request, Instant serverReceiveAt) {
        requireNoActiveTransaction("create");
        access.requireActiveUser(userId);
        SessionAccess.requireOwnedDevice(
                userId,
                referenceRepository.findDevice(request.controlDeviceId()),
                request.controlDeviceId() == request.relayDeviceId()
                        ? DeviceType.PHONE
                        : DeviceType.WATCH);
        SessionAccess.requireOwnedDevice(
                userId, referenceRepository.findDevice(request.relayDeviceId()), DeviceType.PHONE);
        sessionRepository
                .findActiveSessionId(userId)
                .ifPresent(
                        id -> {
                            throw new ApiException(
                                    ErrorCode.ACTIVE_SESSION_EXISTS, Map.of("sessionId", id));
                        });
        var prepared = planPreparation.prepare(userId, request.goal());
        return writeTransaction()
                .execute(
                        status -> {
                            RunningSession session =
                                    createReadySession(
                                            userId,
                                            request.controlDeviceId(),
                                            request.relayDeviceId(),
                                            request.goal(),
                                            prepared);
                            return access.response(session, serverReceiveAt);
                        });
    }

    /**
     * 그룹런 준비(G16)용 READY 세션 생성. 호출 전에 그룹 행을 잠근다. 본인 연결 기기를 쓰며, 선택을 생략하면 워치가 있을 때 워치를 우선한다.
     * 활성 세션이 있으면 ACTIVE_SESSION_EXISTS다.
     * 반환 ID를 참가 관계 session_id에 저장하는 것은 호출자 책임이다.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public long createReadyForGroupParticipant(
            long userId,
            SessionGoal goal,
            SessionPlanPreparation.Prepared prepared,
            String recordingDevice) {
        Long watchId =
                DeviceType.PHONE.name().equals(recordingDevice)
                        ? null
                        : referenceRepository
                                .lockLinkedDeviceId(userId, DeviceType.WATCH.name())
                                .orElse(null);
        if (DeviceType.WATCH.name().equals(recordingDevice) && watchId == null) {
            throw new ApiException(ErrorCode.DEVICE_NOT_FOUND);
        }
        long phoneId =
                referenceRepository
                        .lockLinkedDeviceId(userId, DeviceType.PHONE.name())
                        .orElseThrow(() -> new ApiException(ErrorCode.DEVICE_NOT_FOUND));
        return createReadySession(
                        userId, watchId == null ? phoneId : watchId, phoneId, goal, prepared)
                .getId();
    }

    private RunningSession createReadySession(
            long userId,
            long controlDeviceId,
            long relayDeviceId,
            SessionGoal goal,
            SessionPlanPreparation.Prepared prepared) {
        access.requireActiveUser(userId);
        access.requireOwnedDevice(
                userId, controlDeviceId,
                controlDeviceId == relayDeviceId ? DeviceType.PHONE : DeviceType.WATCH);
        access.requireOwnedDevice(userId, relayDeviceId, DeviceType.PHONE);
        validateTargets(goal);
        CourseInfo course = access.requireUsableCourse(userId, goal.courseId());

        referenceRepository.lockSessionCreation(userId);
        validateComparison(userId, goal);
        sessionRepository
                .findActiveSessionId(userId)
                .ifPresent(
                        activeId -> {
                            throw new ApiException(
                                    ErrorCode.ACTIVE_SESSION_EXISTS, Map.of("sessionId", activeId));
                        });

        planPreparation.verify(userId, goal, prepared);
        var draft = prepared.draft();
        Instant now = now();
        RunningSession session =
                sessionRepository.saveAndFlush(
                        RunningSession.ready(userId, controlDeviceId, relayDeviceId, goal, now));
        draft.ifPresent(plan -> savePlan(session.getId(), plan, now));
        return session;
    }

    /** S02. 상태·계획·명령을 한 스냅샷에서 읽기 위해 REPEATABLE READ로 조회한다. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public RunningSessionResponse get(long userId, long sessionId, Instant serverReceiveAt) {
        access.requireActiveUser(userId);
        RunningSession session =
                sessionRepository
                        .findById(sessionId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.isDeleted()) {
            throw new ApiException(ErrorCode.SESSION_NOT_FOUND);
        }
        if (session.getUserId() != userId) {
            throw new ApiException(ErrorCode.SESSION_FORBIDDEN);
        }
        return access.response(session, serverReceiveAt);
    }

    /**
     * S08 UPDATE_GOAL / TAKE_OVER_PHONE / ABORT_UNCONFIRMED_START. 변경 후 전체 상태를 반환한다.
     *
     * <p>이 메서드에도 트랜잭션 선언을 두지 않는다(S15P31E105-822, {@link #create} 참고). UPDATE_GOAL의 사전 조회가 쥔 커넥션을 AI09 개인 계획
     * 호출(최대 40초, 재시도 포함) 동안 붙잡지 않게 한다. 호출자 트랜잭션 안에서 부르면 작업 종류와 관계없이 맨 앞에서 {@link
     * IllegalStateException}으로 거절한다.
     */
    public RunningSessionResponse update(
            long userId,
            long sessionId,
            UpdateRunningSessionRequest request,
            Instant serverReceiveAt) {
        requireNoActiveTransaction("update");
        SessionPlanPreparation.Prepared prepared = null;
        if (request.operation() == UpdateRunningSessionRequest.Operation.UPDATE_GOAL) {
            access.requireActiveUser(userId);
            var current =
                    sessionRepository
                            .findById(sessionId)
                            .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
            if (current.isDeleted()) throw new ApiException(ErrorCode.SESSION_NOT_FOUND);
            if (current.getUserId() != userId) throw new ApiException(ErrorCode.SESSION_FORBIDDEN);
            var next = request.goalPatch().applyTo(current.goal());
            if (!next.sameAs(current.goal())) {
                if (current.getStatus() != RunningSessionStatus.READY
                        || referenceRepository.findGroupRunId(sessionId).isPresent())
                    throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
                if (current.getStateVersion() != request.expectedVersion())
                    throw new ApiException(ErrorCode.STALE_STATE);
                prepared = planPreparation.prepare(userId, next);
            }
        }
        var result = prepared;
        return writeTransaction()
                .execute(
                        status ->
                                updateStored(userId, sessionId, request, serverReceiveAt, result));
    }

    private RunningSessionResponse updateStored(
            long userId,
            long sessionId,
            UpdateRunningSessionRequest request,
            Instant serverReceiveAt,
            SessionPlanPreparation.Prepared prepared) {
        LockedSession locked =
                access.lockOwnedSession(userId, sessionId, SessionAccess.LockPurpose.UPDATE);
        RunningSession session = locked.session();
        switch (request.operation()) {
            case UPDATE_GOAL -> updateGoal(userId, locked, request, prepared);
            case TAKE_OVER_PHONE -> takeOverPhone(userId, session, request);
            case ABORT_UNCONFIRMED_START -> abortUnconfirmedStart(userId, session, request);
            case REPORT_PREPARED ->
                    throw new IllegalArgumentException("REPORT_PREPARED는 reportPrepared로 처리한다.");
        }
        sessionRepository.flush();
        events.publishEvent(SessionStreamChanged.state(session.getId()));
        return access.response(session, serverReceiveAt);
    }

    /** S08 REPORT_PREPARED. 별도 준비 장부를 두지 않으며 DB를 바꾸지 않는다. */
    @Transactional(readOnly = true)
    public PreparedResponse reportPrepared(
            long userId, long sessionId, UpdateRunningSessionRequest request) {
        access.requireActiveUser(userId);
        RunningSession session =
                sessionRepository
                        .findById(sessionId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.isDeleted()) {
            throw new ApiException(ErrorCode.SESSION_NOT_FOUND);
        }
        if (session.getUserId() != userId) {
            throw new ApiException(ErrorCode.SESSION_FORBIDDEN);
        }
        if (!request.deviceId().equals(session.getControlDeviceId()) || session.isPhoneFallback()) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
        SessionAccess.requireOwnedDevice(
                userId, referenceRepository.findDevice(request.deviceId()), DeviceType.WATCH);
        if (session.getStatus() != RunningSessionStatus.READY) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (session.getStateVersion() != request.expectedVersion()) {
            throw new ApiException(ErrorCode.STALE_STATE);
        }
        return new PreparedResponse(request.expectedVersion());
    }

    /** S09. 세션과 본인 연결 게시물을 같은 시각으로 삭제 표시한다. 하나라도 실패하면 모두 롤백한다. */
    @Transactional
    public DeletedSessionResponse delete(long userId, long sessionId) {
        LockedSession locked =
                access.lockOwnedSession(userId, sessionId, SessionAccess.LockPurpose.DELETE);
        RunningSession session = locked.session();
        requireDeletable(session);
        if (locked.groupRunId() != null) {
            if (!locked.groupCompleted()
                    || !referenceRepository.groupAnalysisSettled(locked.groupRunId())) {
                throw new ApiException(ErrorCode.SESSION_INVALID_STATE, "삭제");
            }
        }

        List<PostRef> posts = referenceRepository.lockPostsOfSession(sessionId);
        if (posts.stream().anyMatch(post -> post.authorId() != userId)) {
            log.error("다른 회원의 게시물이 러닝 세션을 참조해 삭제를 중단함. sessionId={}", sessionId);
            throw new ApiException(ErrorCode.INTERNAL_ERROR);
        }
        Instant deletedAt = now();
        session.markDeleted(deletedAt);
        sessionRepository.flush();
        referenceRepository.markPostsDeleted(sessionId, userId, deletedAt);
        // 커밋 뒤 전송 단계가 삭제를 확인하고 열린 S10 스트림을 닫는다.
        events.publishEvent(SessionStreamChanged.state(sessionId));
        // S15P31E105-599: 커밋 후 이 러닝의 부하를 지우고 일별 부하를 다시 계산한다(TrainingLoadListener).
        events.publishEvent(new RunningSessionDeletedEvent(sessionId));
        return new DeletedSessionResponse(sessionId, deletedAt);
    }

    private void updateGoal(
            long userId,
            LockedSession locked,
            UpdateRunningSessionRequest request,
            SessionPlanPreparation.Prepared prepared) {
        RunningSession session = locked.session();
        SessionGoal goal = request.goalPatch().applyTo(session.goal());
        if (goal.sameAs(session.goal())) {
            return;
        }
        if (session.getStatus() != RunningSessionStatus.READY || locked.groupRunId() != null) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (access.pendingCommand(session) != null) {
            throw new ApiException(ErrorCode.COMMAND_PENDING);
        }
        if (session.getStateVersion() != request.expectedVersion()) {
            throw new ApiException(ErrorCode.STALE_STATE);
        }
        validateTargets(goal);
        CourseInfo course = access.requireUsableCourse(userId, goal.courseId());
        // 비교 대상·코스가 그대로면 기존 참조를 보존한다(S09 삭제 후 참조 규칙). 새 조합만 다시 검사한다.
        SessionGoal current = session.goal();
        if (!Objects.equals(goal.comparisonSessionId(), current.comparisonSessionId())
                || !Objects.equals(goal.courseId(), current.courseId())) {
            validateComparison(userId, goal);
        }

        planPreparation.verify(userId, goal, prepared);
        var draft = prepared.draft();
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
        if (session.isPhoneOnly()) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (session.isPhoneFallback()) {
            return;
        }
        if (!request.receivedWatchBatchesUploaded()) {
            throw new ApiException(ErrorCode.UPLOAD_PENDING);
        }
        boolean started =
                session.getStartedAt() != null
                        && (session.getStatus() == RunningSessionStatus.RUNNING
                                || session.getStatus() == RunningSessionStatus.PAUSED);
        if (!started || session.getStateVersion() < 1 || session.getControlDeviceId() == null) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (session.getStateVersion() != request.expectedVersion()) {
            throw new ApiException(ErrorCode.STALE_STATE);
        }
        controlEventRepository
                .findFirstBySessionIdAndDeviceIdAndResultIn(
                        session.getId(), session.getControlDeviceId(), UNCONFIRMED)
                .ifPresent(
                        event ->
                                event.markUnknownIfPending(SessionControlEvent.WATCH_DISCONNECTED));
        session.takeOverByRelayPhone(now());
    }

    /** 같은 폰의 재요청은 버전 검사보다 먼저 이미 중단된 동일 세션인지 확인한다. */
    private void abortUnconfirmedStart(
            long userId, RunningSession session, UpdateRunningSessionRequest request) {
        requireAbortingPhone(userId, session, request.deviceId());
        if (isAbortedUnconfirmedStart(session)) {
            return;
        }
        SessionControlEvent pending = access.pendingCommand(session);
        if (session.getStatus() != RunningSessionStatus.READY
                || session.getStartedAt() != null
                || pending == null
                || pending.getAction() != ControlAction.START) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (session.getStateVersion() != request.expectedVersion()) {
            throw new ApiException(ErrorCode.STALE_STATE);
        }
        pending.markUnknownIfPending(SessionControlEvent.START_UNCONFIRMED_ABORTED);
        session.abortUnconfirmedStart(now());
        // A group member's start is now settled; the group may be able to finish (S15P31E105-734).
        referenceRepository
                .findGroupRunId(session.getId())
                .ifPresent(
                        groupRunId ->
                                events.publishEvent(
                                        new GroupParticipantSettledEvent(
                                                session.getId(), groupRunId)));
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
                    case CANCELLED -> access.pendingCommand(session) == null;
                    case COMPLETED ->
                            ANALYSIS_SETTLED.contains(session.getAnalysisStatus())
                                    && access.pendingCommand(session) == null;
                    // 관리상 중단 후 보존한 UNKNOWN은 현재 미확정 명령으로 보지 않는다.
                    case INTERRUPTED -> !hasPendingResult(session);
                    case READY, RUNNING, PAUSED -> false;
                };
        if (!allowed) {
            throw new ApiException(ErrorCode.SESSION_INVALID_STATE, "삭제");
        }
    }

    /**
     * 시작 미확인 중단은 세션의 중계 폰이 요청한다. 중계 폰이 연결 해제됐으면(재설치 후 새 ID 등록 등) 세션을 정리할 다른 방법이 없으므로 본인의 현재 연결된 다른
     * 폰도 허용한다. 중계 폰이 연결 중이면 그 폰만 허용한다. 세션의 relayDeviceId는 바꾸지 않는다.
     */
    private void requireAbortingPhone(long userId, RunningSession session, long deviceId) {
        Long relayDeviceId = session.getRelayDeviceId();
        if (relayDeviceId == null) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
        if (relayDeviceId != deviceId) {
            boolean relayLinked =
                    referenceRepository
                            .lockDevice(relayDeviceId)
                            .map(DeviceRef::linked)
                            .orElse(false);
            if (relayLinked) {
                throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
            }
        }
        access.requireOwnedDevice(userId, deviceId, DeviceType.PHONE);
    }

    private void requireRelayPhone(long userId, RunningSession session, long deviceId) {
        if (session.getRelayDeviceId() == null || session.getRelayDeviceId() != deviceId) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
        access.requireOwnedDevice(userId, deviceId, DeviceType.PHONE);
    }

    /** 거리·시간·페이스는 양수이며 최대 2개까지 지정한다. 목표 거리는 45km 이하다. */
    static void validateTargets(SessionGoal goal) {
        if (isNotPositive(goal.distanceM())
                || (goal.distanceM() != null && goal.distanceM() > MAX_TARGET_DISTANCE_M)
                || isNotPositive(goal.durationSec())
                || (goal.paceSecPerKm() != null && goal.paceSecPerKm().signum() <= 0)
                || goal.targetCount() > 2) {
            throw new ApiException(ErrorCode.INVALID_GOAL);
        }
    }

    private static boolean isNotPositive(Integer value) {
        return value != null && value <= 0;
    }

    /** 자유러닝에는 비교 모드가 없다. 비교 기록은 본인·미삭제·COMPLETED·같은 코스여야 한다. */
    private void validateComparison(long userId, SessionGoal goal) {
        if (goal.comparisonSessionId() == null) {
            return;
        }
        if (goal.courseId() == null) {
            throw new ApiException(ErrorCode.INVALID_COMPARISON_SESSION);
        }
        boolean valid =
                referenceRepository
                        .lockComparisonCandidate(userId, goal.comparisonSessionId())
                        .filter(c -> !c.deleted())
                        .filter(c -> RunningSessionStatus.COMPLETED.name().equals(c.status()))
                        .filter(c -> goal.courseId().equals(c.courseId()))
                        .isPresent();
        if (!valid) {
            throw new ApiException(ErrorCode.INVALID_COMPARISON_SESSION);
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

    private boolean hasPendingResult(RunningSession session) {
        return session.getControlDeviceId() != null
                && controlEventRepository
                        .findFirstBySessionIdAndDeviceIdAndResultIn(
                                session.getId(),
                                session.getControlDeviceId(),
                                EnumSet.of(ControlResult.PENDING))
                        .isPresent();
    }

    /** 사전 조회·AI 호출이 호출자 트랜잭션에 합류하지 않도록 직접 거절한다(S15P31E105-822). */
    private static void requireNoActiveTransaction(String operation) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException(
                    "RunningSessionService." + operation + " requires no active transaction");
        }
    }

    private TransactionTemplate writeTransaction() {
        var tx = new TransactionTemplate(transactionManager);
        tx.setIsolationLevel(
                org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
        return tx;
    }

    /** PostgreSQL TIMESTAMPTZ는 마이크로초까지 저장하므로 응답과 DB 값이 같도록 자른다. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }
}
