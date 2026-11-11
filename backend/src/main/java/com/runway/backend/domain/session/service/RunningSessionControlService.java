package com.runway.backend.domain.session.service;

import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.session.dto.request.SessionControlRequest;
import com.runway.backend.domain.session.dto.response.CancelledSessionResponse;
import com.runway.backend.domain.session.dto.response.ControlApprovalResponse;
import com.runway.backend.domain.session.dto.response.ControlResultResponse;
import com.runway.backend.domain.session.dto.response.GroupStartCommand;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.RunningSessionStatus;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import com.runway.backend.domain.session.stream.SessionStreamChanged;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Collection;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * S03~S06 공통 제어(REQUEST → 현재 실행기기 적용 → RESULT)와 S07 준비 취소.
 *
 * <p>모든 요청은 (그룹 행 →) 세션 행을 잠근 뒤 처리한다. 같은 세션의 승인·결과 저장·취소가 이 잠금으로 직렬화되며, uq_control_version(세션·기준
 * 버전)과 uq_control_pending(세션·기기의 미확정 명령 1개)이 마지막 방어선이다. 결과 저장·상태 전이·버전 증가는 한 트랜잭션이다.
 */
@Service
@RequiredArgsConstructor
public class RunningSessionControlService {

    private final SessionAccess access;
    private final SessionControlEventRepository controlEventRepository;
    private final ApplicationEventPublisher events;
    private final RunningSessionRepository sessionRepository;

    /** REQUEST면 {@link ControlApprovalResponse}, RESULT면 {@link ControlResultResponse}를 반환한다. */
    @Transactional
    public Object control(
            long userId,
            long sessionId,
            ControlAction action,
            SessionControlRequest request,
            Instant serverReceiveAt) {
        LockedSession locked =
                access.lockOwnedSession(userId, sessionId, SessionAccess.LockPurpose.UPDATE);
        if (request.phase() == SessionControlRequest.Phase.REQUEST) {
            return approve(userId, locked, action, request);
        }
        return report(userId, locked, action, request, serverReceiveAt);
    }

    /**
     * S07 준비 취소. START 승인·결과 저장과 같은 세션 잠금으로 직렬화된다. 미확정 START가 있으면 취소하지 않고, 같은 취소 재요청은 버전을 다시 올리지 않고
     * 현재 결과를 돌려준다. 실제 운동 종료는 S06을 쓴다.
     */
    @Transactional
    public CancelledSessionResponse cancel(long userId, long sessionId) {
        RunningSession session =
                access.lockOwnedSession(userId, sessionId, SessionAccess.LockPurpose.CANCEL)
                        .session();
        SessionControlEvent pending = access.pendingCommand(session);
        if (pending != null && pending.getAction() == ControlAction.START) {
            throw new ApiException(ErrorCode.COMMAND_PENDING);
        }
        // V1 기존 세션(stateVersion=0)은 상태를 바꾸지 않아 legacy 구분을 유지한다.
        if (session.getStateVersion() < 1) {
            throw new ApiException(ErrorCode.SESSION_INVALID_STATE, "취소");
        }
        if (session.getStatus() != RunningSessionStatus.CANCELLED) {
            if (session.getStatus() != RunningSessionStatus.READY) {
                throw new ApiException(ErrorCode.SESSION_INVALID_STATE, "취소");
            }
            session.cancel(now());
            events.publishEvent(SessionStreamChanged.state(session.getId()));
        }
        return new CancelledSessionResponse(session.getId(), session.getStatus().name());
    }

    /**
     * G09 그룹 시작 승인의 개인 세션 처리. 호출자가 그룹 행을 먼저 잠그고 세션을 ID 오름차순으로 호출한다. 개인 S03과 달리 그룹 연결 세션을 거절하지 않으며 요청
     * 기기·버전은 서버가 잠근 세션에서 읽는다.
     *
     * <p>이미 CANCELLED·INTERRUPTED·COMPLETED인 세션은 시작 대상이 아니므로 빈 값을 돌려준다. RUNNING·PAUSED, 구버전(stateVersion=0),
     * 그룹 목표와 다른 READY 세션은 409 INVALID_SESSION_STATE다. 어느 하나라도 예외를 던지면 호출자 트랜잭션 전체가 롤백된다.
     */
    @Transactional
    public Optional<GroupStartCommand> approveGroupStart(
            long participantUserId, long sessionId, SessionGoal groupGoal) {
        LockedSession locked =
                access.lockOwnedSession(
                        participantUserId, sessionId, SessionAccess.LockPurpose.UPDATE);
        RunningSession session = locked.session();
        RunningSessionStatus status = session.getStatus();
        if (status == RunningSessionStatus.RUNNING || status == RunningSessionStatus.PAUSED) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (status != RunningSessionStatus.READY) {
            return Optional.empty();
        }
        if (session.getStateVersion() < 1 || !sameGroupGoal(session, groupGoal)) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        Long controlDeviceId = session.getControlDeviceId();
        if (controlDeviceId == null) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
        // 제어기기는 본인의 연결된 WATCH여야 한다(폰 대체 제어는 START를 승인하지 않는다).
        access.requireOwnedDevice(participantUserId, controlDeviceId, DeviceType.WATCH);
        access.requireUsableCourse(participantUserId, session.getCourseId());
        if (access.pendingCommand(session) != null) {
            throw new ApiException(ErrorCode.COMMAND_PENDING);
        }
        long expectedVersion = session.getStateVersion();
        if (controlEventRepository
                .findBySessionIdAndExpectedVersion(session.getId(), expectedVersion)
                .isPresent()) {
            throw new ApiException(ErrorCode.COMMAND_CONFLICT);
        }
        SessionControlEvent approved =
                controlEventRepository.saveAndFlush(
                        SessionControlEvent.request(
                                session.getId(),
                                controlDeviceId,
                                ControlAction.START,
                                expectedVersion,
                                now()));
        events.publishEvent(SessionStreamChanged.state(session.getId()));
        return Optional.of(GroupStartCommand.of(approved, session));
    }

    /**
     * G09 재요청 복원. 세션별 첫 START 명령과 현재 결과를 세션 ID 순서로 돌려준다. 새 명령을 만들지 않고 현재 세션 상태·버전·기기는 다시 검사하지 않는다. START가 없는
     * 세션은 결과에서 빠진다.
     */
    @Transactional(readOnly = true)
    public List<GroupStartCommand> findGroupStartCommands(Collection<Long> sessionIds) {
        return sessionIds.stream()
                .sorted()
                .map(
                        sessionId ->
                                controlEventRepository
                                        .findFirstBySessionIdAndActionOrderByIdAsc(
                                                sessionId, ControlAction.START)
                                        .flatMap(
                                                event ->
                                                        sessionRepository
                                                                .findById(sessionId)
                                                                .map(
                                                                        session ->
                                                                                GroupStartCommand.of(
                                                                                        event,
                                                                                        session))))
                .flatMap(Optional::stream)
                .toList();
    }

    /** G12가 참가 세션 하나에 적용한 결과. */
    public enum GroupFinishOutcome {
        /** 미확정 START를 관리상 중단했다(INTERRUPTED·분석 FAILED, 버전 +1). */
        START_ABORTED,
        /** 현재 제어기기에 END PENDING을 새로 승인했다. */
        END_REQUESTED,
        /** 현재 제어기기의 미확정 END가 이미 있어 재사용했다. */
        END_REUSED,
        /** 다른 개인 제어가 미확정이거나 제어기기가 없어 END를 만들지 않았다. 해당 결과 확인 뒤 앱이 S06으로 종료한다. */
        END_DEFERRED,
        /** 이미 끝났거나 시작 승인 전이라 건드리지 않았다. */
        UNTOUCHED
    }

    /**
     * G12 강제 종료의 개인 세션 처리. 호출자가 그룹 행을 먼저 잠그고 세션을 ID 오름차순으로 호출한다. 폰 기기를 요구하지 않는 서버 측 관리 처리다.
     *
     * <ul>
     *   <li>시작 전(READY, 시작시각 없음) 세션의 START가 PENDING/UNKNOWN이면 중단한다. 기존 UNKNOWN 사유는 보존한다.
     *   <li>RUNNING/PAUSED(시작시각 있음)이면 현재 제어기기의 END를 PENDING으로 승인한다. 미확정 END는 재사용하고, 다른 미확정 개인 제어가 있으면
     *       END를 만들지 않고 보류한다(그룹 종료 자체는 막지 않는다).
     *   <li>그 밖의 상태는 바꾸지 않는다.
     * </ul>
     */
    @Transactional
    public GroupFinishOutcome forceFinishGroupParticipant(long sessionId) {
        RunningSession session = sessionRepository.findByIdForUpdate(sessionId).orElse(null);
        if (session == null || session.isDeleted() || session.getStateVersion() < 1) {
            return GroupFinishOutcome.UNTOUCHED;
        }
        RunningSessionStatus status = session.getStatus();
        if (status == RunningSessionStatus.READY && session.getStartedAt() == null) {
            Optional<SessionControlEvent> start =
                    controlEventRepository
                            .findFirstBySessionIdAndActionOrderByIdAsc(
                                    session.getId(), ControlAction.START)
                            .filter(SessionControlEvent::isUnconfirmed);
            if (start.isEmpty()) {
                return GroupFinishOutcome.UNTOUCHED;
            }
            start.get().markUnknownIfPending(SessionControlEvent.START_UNCONFIRMED_ABORTED);
            session.abortUnconfirmedStart(now());
            controlEventRepository.flush();
            events.publishEvent(SessionStreamChanged.state(session.getId()));
            return GroupFinishOutcome.START_ABORTED;
        }
        boolean started =
                session.getStartedAt() != null
                        && (status == RunningSessionStatus.RUNNING
                                || status == RunningSessionStatus.PAUSED);
        if (!started) {
            return GroupFinishOutcome.UNTOUCHED;
        }
        SessionControlEvent pending = access.pendingCommand(session);
        if (pending != null) {
            if (pending.getAction() == ControlAction.END) {
                events.publishEvent(SessionStreamChanged.serverEnd(session.getId(), pending.getId()));
                return GroupFinishOutcome.END_REUSED;
            }
            // 그룹 종료(groupEndedAt)만 바뀌었다. 폰은 미확정 명령의 결과 확인 뒤 S06으로 종료한다.
            events.publishEvent(SessionStreamChanged.state(session.getId()));
            return GroupFinishOutcome.END_DEFERRED;
        }
        Long controlDeviceId = session.getControlDeviceId();
        long expectedVersion = session.getStateVersion();
        if (controlDeviceId == null
                || controlEventRepository
                        .findBySessionIdAndExpectedVersion(session.getId(), expectedVersion)
                        .isPresent()) {
            events.publishEvent(SessionStreamChanged.state(session.getId()));
            return GroupFinishOutcome.END_DEFERRED;
        }
        SessionControlEvent end =
                controlEventRepository.saveAndFlush(
                        SessionControlEvent.request(
                                session.getId(),
                                controlDeviceId,
                                ControlAction.END,
                                expectedVersion,
                                now()));
        events.publishEvent(SessionStreamChanged.serverEnd(session.getId(), end.getId()));
        return GroupFinishOutcome.END_REQUESTED;
    }

    private static boolean sameGroupGoal(RunningSession session, SessionGoal groupGoal) {
        return Objects.equals(session.getCourseId(), groupGoal.courseId())
                && Objects.equals(session.getGoalDistance(), groupGoal.distanceM())
                && Objects.equals(session.getGoalDuration(), groupGoal.durationSec());
    }

    /**
     * 실행기기의 실제 결과를 저장한다. 확정 결과(APPLIED·REJECTED)는 처음 저장할 때 버전을 1 올리고, UNKNOWN은 상태·버전을 바꾸지 않는다. 확정 후
     * 같은 결과·UNKNOWN 재보고는 기존 결과를, 다른 결과는 409 COMMAND_CONFLICT를 반환한다. 서버는 적용 시각을 추정하지 않는다.
     */
    private ControlResultResponse report(
            long userId,
            LockedSession locked,
            ControlAction action,
            SessionControlRequest request,
            Instant serverReceiveAt) {
        RunningSession session = locked.session();
        SessionControlEvent event =
                controlEventRepository
                        .findByIdAndSessionId(request.commandId(), session.getId())
                        .filter(found -> found.getAction() == action)
                        .orElseThrow(() -> new ApiException(ErrorCode.COMMAND_NOT_FOUND));
        if (event.getDeviceId() != request.deviceId()) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
        // 이미 저장된 같은 결과의 재전송(응답 유실 복구)은 인계·기기 해제 뒤에도 기존 응답을 돌려준다. 상태를 바꾸지 않으므로 현재 제어기기·기기 연결
        // 검사보다 먼저 판단한다. 저장되지 않은 늦은 결과와 다른 결과는 아래 검사로 거절한다(세션 제어 공통 계약 "멱등·순서·원자 저장").
        if (event.isConfirmed()
                && event.sameOutcome(request.result(), request.appliedAt(), request.reasonCode())) {
            return resultResponse(event, session, serverReceiveAt);
        }
        boolean executedByPhone = event.getDeviceId().equals(session.getRelayDeviceId());
        access.requireOwnedDevice(
                userId, request.deviceId(), executedByPhone ? DeviceType.PHONE : DeviceType.WATCH);
        // S08로 관리상 중단한 세션의 늦은 결과는 상태를 되돌리지 않고 거절한다.
        if (session.getStatus() == RunningSessionStatus.INTERRUPTED) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (!event.getDeviceId().equals(session.getControlDeviceId())) {
            throw new ApiException(ErrorCode.CONTROL_DEVICE_CHANGED);
        }

        ControlResult result = request.result();
        if (event.isConfirmed()) {
            if (result == ControlResult.UNKNOWN
                    || event.sameOutcome(result, request.appliedAt(), request.reasonCode())) {
                return resultResponse(event, session, serverReceiveAt);
            }
            throw new ApiException(ErrorCode.COMMAND_CONFLICT);
        }

        Instant now = now();
        switch (result) {
            case APPLIED -> {
                // 실제 종료시각은 실제 시작시각보다 늦어야 한다(S06 오류 응답, 2026-11-02 확정).
                if (action == ControlAction.END
                        && session.getStartedAt() != null
                        && !request.appliedAt().isAfter(session.getStartedAt())) {
                    throw new ApiException(ErrorCode.VALIDATION_ERROR_SESSION_REPORT);
                }
                if (action == ControlAction.END && !Boolean.TRUE.equals(request.uploadComplete())) {
                    throw new ApiException(ErrorCode.UPLOAD_PENDING);
                }
                if (!RunningSession.canApprove(action, session.getStatus())) {
                    throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
                }
                event.recordResult(result, request.appliedAt(), request.reasonCode());
                session.applyControl(action, request.appliedAt(), now);
                if (action == ControlAction.END) {
                    events.publishEvent(
                            new PersonalSessionEndedEvent(
                                    session.getId(), locked.groupRunId(), request.appliedAt()));
                }
            }
            case REJECTED -> {
                event.recordResult(result, null, request.reasonCode());
                session.confirmRejection(now);
            }
            case UNKNOWN -> event.recordResult(result, null, request.reasonCode());
            default -> throw new IllegalArgumentException("unsupported result " + result);
        }
        controlEventRepository.flush();
        events.publishEvent(SessionStreamChanged.state(session.getId()));
        return resultResponse(event, session, serverReceiveAt);
    }

    private ControlResultResponse resultResponse(
            SessionControlEvent event, RunningSession session, Instant serverReceiveAt) {
        return new ControlResultResponse(
                event.getId(),
                event.getResult().name(),
                true,
                access.response(session, serverReceiveAt));
    }

    /**
     * 같은 요청 슬롯(세션·기준 버전)을 먼저 찾아 재전송이면 저장된 명령을 그대로 돌려준다. 그 다음 현재 제어기기·버전·허용 상태·미확정 명령을 검사한다. 이 순서여야
     * 적용 뒤의 재전송도 새 명령을 만들지 않는다(세션 제어 공통 계약 "멱등·순서·원자 저장").
     */
    private ControlApprovalResponse approve(
            long userId,
            LockedSession locked,
            ControlAction action,
            SessionControlRequest request) {
        RunningSession session = locked.session();
        long expectedVersion = request.expectedVersion();
        var slot =
                controlEventRepository.findBySessionIdAndExpectedVersion(
                        session.getId(), expectedVersion);
        if (slot.isPresent()) {
            SessionControlEvent existing = slot.get();
            if (existing.getDeviceId() != request.deviceId() || existing.getAction() != action) {
                throw new ApiException(ErrorCode.COMMAND_CONFLICT);
            }
            return ControlApprovalResponse.of(existing);
        }

        Long controlDeviceId = session.getControlDeviceId();
        if (controlDeviceId == null || controlDeviceId != request.deviceId()) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
        boolean phoneFallback = session.isPhoneFallback();
        access.requireOwnedDevice(
                userId, request.deviceId(), phoneFallback ? DeviceType.PHONE : DeviceType.WATCH);
        if (phoneFallback && action == ControlAction.START) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        // 끝난 세션(취소·종료·중단)은 어떤 버전으로도 승인할 수 없으므로 버전보다 먼저 상태로 거절한다(S07 "뒤의 새 START는 상태 검사로 거절").
        if (!session.isActive()) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (session.getStateVersion() != expectedVersion) {
            throw new ApiException(ErrorCode.STALE_STATE);
        }
        if (!RunningSession.canApprove(action, session.getStatus())) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (action == ControlAction.START) {
            // 그룹에 연결된 세션의 새 시작은 G09만 승인한다(group-runs.md G09).
            if (locked.groupRunId() != null) {
                throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
            }
            access.requireUsableCourse(userId, session.getCourseId());
        }
        // 그룹이 종료됐다면 END만 허용한다(세션 제어 공통 계약 "인계 후 폰 제어", S05 "그룹이 종료됐으면 재개하지 않는다").
        if (action != ControlAction.END && access.groupEndedAt(session.getId()).isPresent()) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (access.pendingCommand(session) != null) {
            throw new ApiException(ErrorCode.COMMAND_PENDING);
        }

        SessionControlEvent approved =
                controlEventRepository.saveAndFlush(
                        SessionControlEvent.request(
                                session.getId(),
                                request.deviceId(),
                                action,
                                expectedVersion,
                                now()));
        events.publishEvent(SessionStreamChanged.state(session.getId()));
        return ControlApprovalResponse.of(approved);
    }

    /** PostgreSQL TIMESTAMPTZ는 마이크로초까지 저장하므로 응답과 DB 값이 같도록 자른다. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }
}
