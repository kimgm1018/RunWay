package com.runway.backend.domain.session.service;

import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.course.repository.CourseJdbcRepository;
import com.runway.backend.domain.session.dto.response.RunningSessionResponse;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.PacePlan;
import com.runway.backend.domain.session.entity.PacePlanSegment;
import com.runway.backend.domain.session.entity.RunningSession;
import com.runway.backend.domain.session.entity.RunningSessionStatus;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseResumeEvent;
import com.runway.backend.domain.session.mapper.RunningSessionMapper;
import com.runway.backend.domain.session.mapper.SessionSnapshot;
import com.runway.backend.domain.session.repository.PacePlanRepository;
import com.runway.backend.domain.session.repository.PacePlanSegmentRepository;
import com.runway.backend.domain.session.repository.RunningSessionRepository;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.CourseInfo;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.DeviceRef;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.SessionOwnership;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/** 세션 유스케이스(S01~S09)가 공유하는 회원·소유·잠금·기기·코스 검사와 S02 응답 조립. 호출하는 서비스의 트랜잭션 안에서만 사용한다. */
@Component
@RequiredArgsConstructor
class SessionAccess {

    /** 잠금 목적에 따라 타인 세션·잠금 사이 그룹 연결 변경의 오류 코드가 다르다. */
    enum LockPurpose {
        UPDATE,
        DELETE,
        CANCEL
    }

    static final Set<ControlResult> UNCONFIRMED =
            EnumSet.of(ControlResult.PENDING, ControlResult.UNKNOWN);

    private final RunningSessionRepository sessionRepository;
    private final PacePlanRepository pacePlanRepository;
    private final PacePlanSegmentRepository segmentRepository;
    private final SessionControlEventRepository controlEventRepository;
    private final SessionReferenceRepository referenceRepository;
    private final RecordComparisonService comparisonService;
    private final CourseJdbcRepository courseJdbcRepository;

    /**
     * 그룹 연결 세션은 그룹 행을 먼저 잠근다. 잠금 전 확인과 잠금 후 재확인 사이에 삭제·소유 정보가 바뀌었을 수 있으므로 잠근 행으로 다시 판정한다. 그 사이 그룹
     * 연결이 바뀌었으면 잠근 그룹 행이 맞지 않으므로 S08은 409 STALE_STATE, S09·S07은 409 INVALID_STATE로 거절하고 재조회하게 한다.
     * 세션 행 잠금(PESSIMISTIC_WRITE)은 PostgreSQL에서 FOR NO KEY UPDATE라 FK 검사를 막지 않는다. 이 재확인은 연결을 저장하는 쪽도
     * group-runs.md "그룹 세션 연결의 불변조건"대로 그룹→세션 행을 잠근 뒤 저장한다는 전제에서 유효하다.
     */
    LockedSession lockOwnedSession(long userId, long sessionId, LockPurpose purpose) {
        requireActiveUser(userId);
        SessionOwnership ownership =
                referenceRepository
                        .findOwnership(sessionId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (ownership.deleted()) {
            throw new ApiException(ErrorCode.SESSION_NOT_FOUND);
        }
        if (ownership.userId() != userId) {
            throw notOwner(purpose);
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
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.isDeleted()) {
            throw new ApiException(ErrorCode.SESSION_NOT_FOUND);
        }
        if (session.getUserId() != userId) {
            throw notOwner(purpose);
        }
        Long groupRunId = referenceRepository.findGroupRunId(sessionId).orElse(null);
        if (!Objects.equals(groupRunId, ownership.groupRunId())) {
            throw switch (purpose) {
                case UPDATE -> new ApiException(ErrorCode.STALE_STATE);
                case DELETE -> new ApiException(ErrorCode.SESSION_INVALID_STATE, "삭제");
                case CANCEL -> new ApiException(ErrorCode.SESSION_INVALID_STATE, "취소");
            };
        }
        return new LockedSession(session, ownership.groupRunId(), groupCompleted);
    }

    private static ApiException notOwner(LockPurpose purpose) {
        return switch (purpose) {
            case UPDATE -> new ApiException(ErrorCode.SESSION_FORBIDDEN);
            case DELETE -> new ApiException(ErrorCode.SESSION_DELETE_NOT_OWNER);
            case CANCEL -> new ApiException(ErrorCode.SESSION_CANCEL_FORBIDDEN);
        };
    }

    void requireActiveUser(long userId) {
        if (!referenceRepository.activeUserExists(userId)) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
    }

    /** 기기 행을 잠가 확인하므로 W03 해제와 겹쳐도 해제된 기기로 세션을 저장하지 않는다. */
    void requireOwnedDevice(long userId, long deviceId, DeviceType type) {
        requireOwnedDevice(userId, referenceRepository.lockDevice(deviceId), type);
    }

    static void requireOwnedDevice(long userId, Optional<DeviceRef> found, DeviceType type) {
        DeviceRef device = found.orElseThrow(() -> new ApiException(ErrorCode.DEVICE_FORBIDDEN));
        if (device.userId() != userId
                || !type.name().equals(device.deviceType())
                || !device.linked()) {
            throw new ApiException(ErrorCode.DEVICE_FORBIDDEN);
        }
    }

    CourseInfo requireUsableCourse(long userId, Long courseId) {
        if (courseId == null) {
            return null;
        }
        CourseInfo course =
                referenceRepository
                        .lockCourse(courseId)
                        .orElseThrow(() -> new ApiException(ErrorCode.COURSE_NOT_FOUND));
        if (!course.isActive()) {
            throw new ApiException(ErrorCode.COURSE_INACCESSIBLE);
        }
        if (!courseJdbcRepository.canRead(userId, courseId)) {
            throw new ApiException(ErrorCode.COURSE_INACCESSIBLE);
        }
        return course;
    }

    /** 현재 제어기기의 PENDING/UNKNOWN 명령. 관리상 중단한 세션은 없다. */
    SessionControlEvent pendingCommand(RunningSession session) {
        if (session.getStatus() == RunningSessionStatus.INTERRUPTED
                || session.getControlDeviceId() == null) {
            return null;
        }
        return controlEventRepository
                .findFirstBySessionIdAndDeviceIdAndResultIn(
                        session.getId(), session.getControlDeviceId(), UNCONFIRMED)
                .orElse(null);
    }

    Optional<Instant> groupEndedAt(long sessionId) {
        return referenceRepository.findGroupEndedAt(sessionId);
    }

    RunningSessionResponse response(RunningSession session, Instant serverReceiveAt) {
        PacePlan plan =
                pacePlanRepository.findFirstBySessionIdOrderByIdDesc(session.getId()).orElse(null);
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
                controlEventRepository
                        .findFirstBySessionIdOrderByIdDesc(session.getId())
                        .orElse(null);
        Instant groupEndedAt = referenceRepository.findGroupEndedAt(session.getId()).orElse(null);
        Instant serverSendAt = Instant.now();
        // 진행 중은 serverSendAt, 종료 세션은 endedAt 기준(S15P31E105-643). S10도 이 응답을 그대로 보낸다.
        Instant until = session.getEndedAt() != null ? session.getEndedAt() : serverSendAt;
        Integer movingDurationSec =
                PostRunAnalysisCalculator.movingDurationSec(
                        session.getStartedAt(), until, pauseResumeEvents(session.getId()));
        SessionSnapshot snapshot =
                new SessionSnapshot(
                        session,
                        plan,
                        segments,
                        pending,
                        coachingGuide,
                        last,
                        groupEndedAt,
                        comparisonService.compare(session, serverSendAt),
                        movingDurationSec);
        return RunningSessionMapper.toResponse(snapshot, serverReceiveAt, serverSendAt);
    }

    /** 기록 비교·종료 후 분석과 같은 APPLIED PAUSE/RESUME 조회. */
    private List<PauseResumeEvent> pauseResumeEvents(long sessionId) {
        return controlEventRepository
                .findBySessionIdAndActionInAndResultOrderByAppliedAtAscIdAsc(
                        sessionId,
                        List.of(ControlAction.PAUSE, ControlAction.RESUME),
                        ControlResult.APPLIED)
                .stream()
                .map(event -> new PauseResumeEvent(event.getAction(), event.getAppliedAt()))
                .toList();
    }
}
