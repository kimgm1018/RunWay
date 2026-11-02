package com.runway.backend.domain.session.service;

import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.session.dto.request.SessionControlRequest;
import com.runway.backend.domain.session.dto.response.CancelledSessionResponse;
import com.runway.backend.domain.session.dto.response.ControlApprovalResponse;
import com.runway.backend.domain.session.dto.response.ControlResultResponse;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.RunningSessionStatus;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
     * S07 준비 취소. START 승인·결과 저장과 같은 세션 잠금으로 직렬화된다. 미확정 START가 있으면 취소하지 않고, 같은 취소 재요청은 버전을 다시 올리지
     * 않고 현재 결과를 돌려준다. 실제 운동 종료는 S06을 쓴다.
     */
    @Transactional
    public CancelledSessionResponse cancel(long userId, long sessionId) {
        RunningSession session =
                access.lockOwnedSession(userId, sessionId, SessionAccess.LockPurpose.CANCEL).session();
        SessionControlEvent pending = access.pendingCommand(session);
        if (pending != null && pending.getAction() == ControlAction.START) {
            throw SessionErrors.commandPending();
        }
        // V1 기존 세션(stateVersion=0)은 상태를 바꾸지 않아 legacy 구분을 유지한다.
        if (session.getStateVersion() < 1) {
            throw SessionErrors.invalidCancelState();
        }
        if (session.getStatus() != RunningSessionStatus.CANCELLED) {
            if (session.getStatus() != RunningSessionStatus.READY) {
                throw SessionErrors.invalidCancelState();
            }
            session.cancel(now());
        }
        return new CancelledSessionResponse(session.getId(), session.getStatus().name());
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
                        .orElseThrow(SessionErrors::commandNotFound);
        if (event.getDeviceId() != request.deviceId()) {
            throw SessionErrors.deviceForbidden();
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
            throw SessionErrors.invalidSessionState();
        }
        if (!event.getDeviceId().equals(session.getControlDeviceId())) {
            throw SessionErrors.controlDeviceChanged();
        }

        ControlResult result = request.result();
        if (event.isConfirmed()) {
            if (result == ControlResult.UNKNOWN
                    || event.sameOutcome(result, request.appliedAt(), request.reasonCode())) {
                return resultResponse(event, session, serverReceiveAt);
            }
            throw SessionErrors.commandConflict();
        }

        Instant now = now();
        switch (result) {
            case APPLIED -> {
                // 실제 종료시각은 실제 시작시각보다 늦어야 한다(S06 오류 응답, 2026-11-02 확정).
                if (action == ControlAction.END
                        && session.getStartedAt() != null
                        && !request.appliedAt().isAfter(session.getStartedAt())) {
                    throw SessionErrors.validation("실제 종료시각은 실제 시작시각보다 늦어야 합니다.");
                }
                if (action == ControlAction.END && !Boolean.TRUE.equals(request.uploadComplete())) {
                    throw SessionErrors.uploadPending();
                }
                if (!RunningSession.canApprove(action, session.getStatus())) {
                    throw SessionErrors.invalidSessionState();
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
     * 같은 요청 슬롯(세션·기준 버전)을 먼저 찾아 재전송이면 저장된 명령을 그대로 돌려준다. 그 다음 현재 제어기기·버전·허용 상태·미확정 명령을 검사한다.
     * 이 순서여야 적용 뒤의 재전송도 새 명령을 만들지 않는다(세션 제어 공통 계약 "멱등·순서·원자 저장").
     */
    private ControlApprovalResponse approve(
            long userId, LockedSession locked, ControlAction action, SessionControlRequest request) {
        RunningSession session = locked.session();
        long expectedVersion = request.expectedVersion();
        var slot =
                controlEventRepository.findBySessionIdAndExpectedVersion(
                        session.getId(), expectedVersion);
        if (slot.isPresent()) {
            SessionControlEvent existing = slot.get();
            if (existing.getDeviceId() != request.deviceId() || existing.getAction() != action) {
                throw SessionErrors.commandConflict();
            }
            return ControlApprovalResponse.of(existing);
        }

        Long controlDeviceId = session.getControlDeviceId();
        if (controlDeviceId == null || controlDeviceId != request.deviceId()) {
            throw SessionErrors.deviceForbidden();
        }
        boolean phoneFallback = session.isPhoneFallback();
        access.requireOwnedDevice(
                userId, request.deviceId(), phoneFallback ? DeviceType.PHONE : DeviceType.WATCH);
        if (phoneFallback && action == ControlAction.START) {
            throw SessionErrors.invalidSessionState();
        }
        // 끝난 세션(취소·종료·중단)은 어떤 버전으로도 승인할 수 없으므로 버전보다 먼저 상태로 거절한다(S07 "뒤의 새 START는 상태 검사로 거절").
        if (!session.isActive()) {
            throw SessionErrors.invalidSessionState();
        }
        if (session.getStateVersion() != expectedVersion) {
            throw SessionErrors.staleState();
        }
        if (!RunningSession.canApprove(action, session.getStatus())) {
            throw SessionErrors.invalidSessionState();
        }
        if (action == ControlAction.START) {
            // 그룹에 연결된 세션의 새 시작은 G09만 승인한다(group-runs.md G09).
            if (locked.groupRunId() != null) {
                throw SessionErrors.invalidSessionState();
            }
            access.requireUsableCourse(session.getCourseId());
        }
        // 그룹이 종료됐다면 END만 허용한다(세션 제어 공통 계약 "인계 후 폰 제어", S05 "그룹이 종료됐으면 재개하지 않는다").
        if (action != ControlAction.END && access.groupEndedAt(session.getId()).isPresent()) {
            throw SessionErrors.invalidSessionState();
        }
        if (access.pendingCommand(session) != null) {
            throw SessionErrors.commandPending();
        }

        SessionControlEvent approved =
                controlEventRepository.saveAndFlush(
                        SessionControlEvent.request(
                                session.getId(), request.deviceId(), action, expectedVersion, now()));
        return ControlApprovalResponse.of(approved);
    }

    /** PostgreSQL TIMESTAMPTZ는 마이크로초까지 저장하므로 응답과 DB 값이 같도록 자른다. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }
}
