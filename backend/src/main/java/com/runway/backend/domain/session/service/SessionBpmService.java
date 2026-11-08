package com.runway.backend.domain.session.service;

import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.session.dto.request.SessionBpmRequest;
import com.runway.backend.domain.session.dto.response.ControlApprovalResponse;
import com.runway.backend.domain.session.dto.response.ControlResultResponse;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.RunningSessionStatus;
import com.runway.backend.domain.session.entity.SessionControlEvent;
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
import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;

/**
 * P07 세션 BPM 조절. 앱의 수동 SET_BPM 승인(REQUEST)과 SET_BPM·COACHING 명령의 실제 결과 저장(RESULT)을 처리한다.
 *
 * <p>S03~S06과 같은 세션 잠금·요청 슬롯(세션·기준 버전)·미확정 명령 1개 규칙으로 다른 제어·서버 코칭과 직렬화한다. 결과 저장·현재 BPM·버전 증가는 한
 * 트랜잭션이다. 수동 BPM은 건강정보를 쓰지 않으므로 동의를 검사하지 않는다(pace-coaching.md P07).
 */
@Service
@RequiredArgsConstructor
public class SessionBpmService {

    private static final Set<ControlAction> BPM_ACTIONS =
            EnumSet.of(ControlAction.SET_BPM, ControlAction.COACHING);

    private final SessionAccess access;
    private final SessionControlEventRepository controlEventRepository;
    private final ApplicationEventPublisher events;

    /** REQUEST면 {@link ControlApprovalResponse}, RESULT면 {@link ControlResultResponse}를 반환한다. */
    @Transactional
    public Object control(
            long userId, long sessionId, SessionBpmRequest request, Instant serverReceiveAt) {
        LockedSession locked =
                access.lockOwnedSession(userId, sessionId, SessionAccess.LockPurpose.UPDATE);
        if (request.phase() == SessionBpmRequest.Phase.REQUEST) {
            return approve(userId, locked, request);
        }
        return report(userId, locked, request, serverReceiveAt);
    }

    private ControlApprovalResponse approve(
            long userId, LockedSession locked, SessionBpmRequest request) {
        RunningSession session = locked.session();
        long expectedVersion = request.expectedVersion();
        var slot =
                controlEventRepository.findBySessionIdAndExpectedVersion(
                        session.getId(), expectedVersion);
        if (slot.isPresent()) {
            SessionControlEvent existing = slot.get();
            if (existing.getDeviceId() != request.deviceId()
                    || existing.getAction() != ControlAction.SET_BPM
                    || !Objects.equals(existing.getTargetBpm(), request.targetBpm())
                    || existing.getCoachingId() != null) {
                throw new ApiException(ErrorCode.COMMAND_CONFLICT);
            }
            return ControlApprovalResponse.of(existing);
        }

        if (session.isPhoneFallback()) {
            // 폰 기록 전환 뒤에는 수동·AI BPM 모두 중단한다(P07 적용 조건). 본인 세션임은 잠금에서 확인했다.
            throw new ApiException(ErrorCode.COACHING_UNAVAILABLE);
        }
        Long controlDeviceId = session.getControlDeviceId();
        if (controlDeviceId == null || controlDeviceId != request.deviceId()) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
        access.requireOwnedDevice(userId, request.deviceId(), DeviceType.WATCH);
        if (!session.isActive()) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (session.getStateVersion() != expectedVersion) {
            throw new ApiException(ErrorCode.STALE_STATE);
        }
        if (!RunningSession.canApprove(ControlAction.SET_BPM, session.getStatus())) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (access.groupEndedAt(session.getId()).isPresent()) {
            // 그룹이 종료됐으면 END만 허용한다(세션 제어 공통 계약 "인계 후 폰 제어").
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (access.pendingCommand(session) != null) {
            throw new ApiException(ErrorCode.COMMAND_PENDING);
        }
        SessionControlEvent approved =
                controlEventRepository.saveAndFlush(
                        SessionControlEvent.bpmRequest(
                                session.getId(),
                                request.deviceId(),
                                ControlAction.SET_BPM,
                                expectedVersion,
                                request.targetBpm(),
                                null,
                                now()));
        events.publishEvent(SessionStreamChanged.state(session.getId()));
        return ControlApprovalResponse.of(approved);
    }

    /**
     * 확정 결과(APPLIED·REJECTED·IGNORED)는 처음 저장할 때 버전을 1 올리고, UNKNOWN은 상태·버전을 바꾸지 않는다. 같은 결과 재전송은 인계·기기
     * 해제 뒤에도 기존 응답을 돌려준다. 만료된 코칭의 결과도 저장한다(만료 검사는 새 REQUEST에만 적용한다).
     */
    private ControlResultResponse report(
            long userId,
            LockedSession locked,
            SessionBpmRequest request,
            Instant serverReceiveAt) {
        RunningSession session = locked.session();
        SessionControlEvent event =
                controlEventRepository
                        .findByIdAndSessionId(request.commandId(), session.getId())
                        .filter(found -> BPM_ACTIONS.contains(found.getAction()))
                        .orElseThrow(() -> new ApiException(ErrorCode.COMMAND_NOT_FOUND));
        ControlResult result = request.result();
        if (result == ControlResult.IGNORED && event.getAction() != ControlAction.COACHING) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        if (event.getDeviceId() != request.deviceId()) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
        if (event.isConfirmed()
                && event.sameOutcome(result, request.appliedAt(), request.reasonCode())) {
            return resultResponse(event, session, serverReceiveAt);
        }
        access.requireOwnedDevice(userId, request.deviceId(), DeviceType.WATCH);
        if (session.getStatus() == RunningSessionStatus.INTERRUPTED) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (!event.getDeviceId().equals(session.getControlDeviceId())) {
            throw new ApiException(ErrorCode.CONTROL_DEVICE_CHANGED);
        }
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
                if (!RunningSession.canApprove(event.getAction(), session.getStatus())) {
                    throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
                }
                event.recordResult(result, request.appliedAt(), request.reasonCode());
                session.applyBpm(event.getTargetBpm(), now);
            }
            case REJECTED, IGNORED -> {
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

    /** PostgreSQL TIMESTAMPTZ는 마이크로초까지 저장하므로 응답과 DB 값이 같도록 자른다. */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }
}
