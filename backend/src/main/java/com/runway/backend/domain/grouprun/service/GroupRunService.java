package com.runway.backend.domain.grouprun.service;

import com.runway.backend.domain.course.repository.CourseJdbcRepository;
import com.runway.backend.domain.course.repository.CourseJdbcRepository.CourseRow;
import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewMembership;
import com.runway.backend.domain.crew.entity.CrewMembershipStatus;
import com.runway.backend.domain.crew.entity.CrewStatus;
import com.runway.backend.domain.crew.repository.CrewMembershipRepository;
import com.runway.backend.domain.crew.repository.CrewRepository;
import com.runway.backend.domain.crew.repository.UserExistsRepository;
import com.runway.backend.domain.grouprun.dto.request.CancelGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.CreateGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.PatchGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.ReadyGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.response.CancelGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.CreateGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.ForceFinishGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunDetailResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunListResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunLiveResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunParticipantsResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunResultsResponse;
import com.runway.backend.domain.grouprun.dto.response.JoinGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.PatchGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.ReadyGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.StartGroupRunResponse;
import com.runway.backend.domain.grouprun.entity.GroupRunCancelReason;
import com.runway.backend.domain.grouprun.entity.GroupRunStatus;
import com.runway.backend.domain.grouprun.entity.ReadyStatus;
import com.runway.backend.domain.grouprun.pace.GroupPaceService;
import com.runway.backend.domain.grouprun.helper.GroupGuidePaceCalculator;
import com.runway.backend.domain.grouprun.helper.GroupResultAggregates;
import com.runway.backend.domain.grouprun.helper.GroupRunFitCalculator;
import com.runway.backend.domain.grouprun.helper.GroupRunGoalCalculator;
import com.runway.backend.domain.grouprun.helper.GroupRunGoalCalculator.ResolvedGoals;
import com.runway.backend.domain.grouprun.helper.GroupRunLivePaceCalculator;
import com.runway.backend.domain.grouprun.helper.GroupRunLoadAlertCalculator;
import com.runway.backend.domain.grouprun.live.GroupRunLiveRanking;
import com.runway.backend.domain.grouprun.live.ParticipantLive;
import com.runway.backend.domain.grouprun.live.ParticipantSample;
import com.runway.backend.domain.grouprun.repository.GroupRunFitJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunParticipantJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunParticipantRow;
import com.runway.backend.domain.grouprun.repository.GroupRunRow;
import com.runway.backend.domain.notification.NotificationType;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.domain.session.dto.response.GroupStartCommand;
import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository.GroupResultRow;
import com.runway.backend.domain.session.service.RunningSessionControlService;
import com.runway.backend.domain.session.service.RunningSessionService;
import com.runway.backend.domain.session.service.SessionPlanPreparation;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonPoint;

import lombok.RequiredArgsConstructor;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class GroupRunService {

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final GroupRunJdbcRepository groupRunJdbcRepository;
    private final GroupRunParticipantJdbcRepository participantJdbcRepository;
    private final GroupRunFitJdbcRepository fitJdbcRepository;
    private final CrewRepository crewRepository;
    private final CrewMembershipRepository crewMembershipRepository;
    private final CourseJdbcRepository courseJdbcRepository;
    private final UserExistsRepository userExistsRepository;
    private final SessionReferenceRepository sessionReferenceRepository;
    private final RunningSessionService runningSessionService;
    private final RunningSessionControlService runningSessionControlService;
    private final NotificationService notificationService;
    private final JsonMapper jsonMapper;
    private final SessionPlanPreparation planPreparation;
    private final PlatformTransactionManager transactionManager;
    private final GroupPaceService groupPaceService;

    @Transactional
    public CreateGroupRunResponse create(long userId, CreateGroupRunRequest request) {
        requireApprovedActiveCrewMember(request.crewId(), userId);

        Integer courseDistanceM = null;
        Long courseId = request.courseId();
        if (courseId != null) {
            courseDistanceM = requireAssignableCourseDistance(courseId);
        }

        ResolvedGoals goals =
                GroupRunGoalCalculator.resolve(
                        request.goalInputType(),
                        request.targetDistanceM(),
                        request.targetDurationSec(),
                        request.targetPaceSecPerKm(),
                        courseDistanceM);

        long groupRunId =
                groupRunJdbcRepository.insert(
                        request.crewId(),
                        userId,
                        courseId,
                        request.title().trim(),
                        blankToNull(request.description()),
                        request.scheduledAt(),
                        request.meetingPlaceName().trim(),
                        blankToNull(request.meetingAddress()),
                        request.meetingPosition(),
                        goals.distanceM(),
                        goals.durationSec(),
                        GroupRunStatus.SCHEDULED.name());
        participantJdbcRepository.insert(groupRunId, userId, false);
        groupPaceService.membershipOrGoalChanged(groupRunId);

        return new CreateGroupRunResponse(
                groupRunId,
                userId,
                GroupRunStatus.SCHEDULED.name(),
                courseId,
                goals.distanceM(),
                goals.durationSec(),
                request.scheduledAt(),
                request.meetingPlaceName().trim(),
                blankToNull(request.meetingAddress()),
                goals.paceSecPerKm());
    }

    @Transactional(readOnly = true)
    public GroupRunListResponse list(
            long userId,
            Long crewId,
            String status,
            String participation,
            Boolean myCrewsOnly,
            Double latitude,
            Double longitude,
            Double radiusM,
            String cursor,
            Integer limit) {
        String normalizedStatus = normalizeStatusFilter(status);
        String normalizedParticipation = normalizeParticipation(participation);
        validateGeoFilter(latitude, longitude, radiusM);
        int pageSize = resolveLimit(limit);
        Long cursorExclusive = parseCursor(cursor);

        List<GroupRunRow> rows =
                groupRunJdbcRepository.search(
                        userId,
                        crewId,
                        normalizedStatus,
                        normalizedParticipation,
                        Boolean.TRUE.equals(myCrewsOnly),
                        latitude,
                        longitude,
                        radiusM,
                        cursorExclusive,
                        pageSize + 1);

        boolean hasMore = rows.size() > pageSize;
        List<GroupRunRow> page = hasMore ? rows.subList(0, pageSize) : rows;
        String nextCursor = hasMore ? String.valueOf(page.get(page.size() - 1).id()) : null;

        List<GroupRunListResponse.Item> items =
                page.stream()
                        .map(
                                row ->
                                        new GroupRunListResponse.Item(
                                                row.id(),
                                                row.title(),
                                                row.hostId(),
                                                row.courseId(),
                                                row.scheduledAt(),
                                                row.status(),
                                                row.goalDistance(),
                                                row.goalDuration()))
                        .toList();
        return new GroupRunListResponse(items, nextCursor);
    }

    @Transactional(readOnly = true)
    public GroupRunDetailResponse getDetail(long userId, long groupRunId) {
        GroupRunRow row = requireGroupRun(groupRunId);
        requireApprovedActiveCrewMember(row.crewId(), userId);
        List<GroupRunParticipantRow> participants =
                participantJdbcRepository.findByGroupRunId(groupRunId);
        int participantCount = participants.size();

        // 참가자와 요청자의 최근 완료 세션 페이스를 한 번에 읽는다(요청자는 참가 전일 수 있다).
        Set<Long> fitUserIds = new LinkedHashSet<>();
        participants.forEach(p -> fitUserIds.add(p.userId()));
        fitUserIds.add(userId);
        Map<Long, List<BigDecimal>> recentPaces =
                fitJdbcRepository.findRecentCompletedPaces(fitUserIds);

        List<Integer> participantPaces =
                participants.stream()
                        .map(
                                p ->
                                        GroupRunFitCalculator.recentPaceSecPerKm(
                                                recentPaces.get(p.userId())))
                        .filter(Objects::nonNull)
                        .toList();
        GroupRunDetailResponse.ComfortRange comfortRange =
                GroupRunFitCalculator.comfortRange(participantPaces, resolveGroupGuidePace(row));

        GroupRunDetailResponse.MyFit myFit = null;
        Integer myPace = GroupRunFitCalculator.recentPaceSecPerKm(recentPaces.get(userId));
        if (myPace != null) {
            myFit =
                    new GroupRunDetailResponse.MyFit(
                            myPace,
                            toScore(
                                    fitJdbcRepository
                                            .findLatestReadinessScores(List.of(userId))
                                            .get(userId)));
        }
        return toDetail(row, participantCount, comfortRange, myFit);
    }

    private static Integer toScore(BigDecimal score) {
        return score == null ? null : score.setScale(0, RoundingMode.HALF_UP).intValue();
    }

    @Transactional
    public PatchGroupRunResponse patch(long userId, long groupRunId, PatchGroupRunRequest request) {
        GroupRunRow row = requireGroupRun(groupRunId);
        if (row.hostId() != userId) {
            throw new ApiException(ErrorCode.NOT_HOST);
        }
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(ErrorCode.EDIT_NOT_ALLOWED);
        }

        String title = request.titlePresent() ? requireNonBlankTitle(request.title()) : row.title();
        String description =
                request.descriptionPresent()
                        ? blankToNull(request.description())
                        : row.description();
        var scheduledAt =
                request.scheduledAtPresent()
                        ? requireScheduledAt(request.scheduledAt())
                        : row.scheduledAt();
        String meetingName =
                request.meetingPlaceNamePresent()
                        ? requireNonBlankMeetingName(request.meetingPlaceName())
                        : row.meetingName();
        String meetingAddress =
                request.meetingAddressPresent()
                        ? blankToNull(request.meetingAddress())
                        : row.meetingAddress();
        GeoJsonPoint meetingPosition =
                request.meetingPositionPresent()
                        ? requireMeetingPosition(request.meetingPosition())
                        : parseMeetingPosition(row.meetingPositionGeoJson());

        Long courseId = row.courseId();
        Integer courseDistanceFallback = null;
        if (request.courseIdPresent()) {
            courseId = request.courseId();
            if (courseId != null) {
                courseDistanceFallback = requireAssignableCourseDistance(courseId);
            }
        } else if (courseId != null && request.anyGoalFieldPresent()) {
            CourseRow course =
                    courseJdbcRepository
                            .findById(courseId)
                            .orElseThrow(GroupRunService::courseNotFound);
            if ("ACTIVE".equals(course.status()) && course.distanceM() != null) {
                courseDistanceFallback = course.distanceM().intValue();
            }
        }

        Integer goalDistance = row.goalDistance();
        Integer goalDuration = row.goalDuration();
        Integer goalPace = GroupRunGoalCalculator.derivePaceSecPerKm(goalDistance, goalDuration);
        if (request.anyGoalFieldPresent()) {
            rejectPartialGoalNullRelease(request);
            Integer distanceInput =
                    request.targetDistanceMPresent()
                            ? request.targetDistanceM()
                            : row.goalDistance();
            ResolvedGoals goals =
                    GroupRunGoalCalculator.resolve(
                            request.goalInputTypePresent() ? request.goalInputType() : null,
                            distanceInput,
                            request.targetDurationSecPresent() ? request.targetDurationSec() : null,
                            request.targetPaceSecPerKmPresent()
                                    ? request.targetPaceSecPerKm()
                                    : null,
                            courseDistanceFallback);
            goalDistance = goals.distanceM();
            goalDuration = goals.durationSec();
            goalPace = goals.paceSecPerKm();
        }

        groupRunJdbcRepository.update(
                groupRunId,
                title,
                description,
                scheduledAt,
                meetingName,
                meetingAddress,
                meetingPosition,
                courseId,
                goalDistance,
                goalDuration);

        GroupRunRow updated = requireGroupRun(groupRunId);
        if (request.anyGoalFieldPresent() || request.courseIdPresent()) {
            groupPaceService.membershipOrGoalChanged(groupRunId);
        }
        return new PatchGroupRunResponse(
                updated.id(),
                updated.title(),
                updated.status(),
                updated.courseId(),
                updated.updatedAt(),
                updated.scheduledAt(),
                updated.meetingName(),
                updated.meetingAddress(),
                updated.goalDistance(),
                updated.goalDuration(),
                goalPace != null
                        ? goalPace
                        : GroupRunGoalCalculator.derivePaceSecPerKm(
                                updated.goalDistance(), updated.goalDuration()));
    }

    @Transactional
    public JoinGroupRunResponse join(long userId, long groupRunId) {
        GroupRunRow row = requireGroupRun(groupRunId);
        requireApprovedActiveCrewMember(row.crewId(), userId);
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE_GROUPRUN_JOIN);
        }
        try {
            var joinedAt = participantJdbcRepository.insert(groupRunId, userId, false);
            groupPaceService.membershipOrGoalChanged(groupRunId);
            return new JoinGroupRunResponse(groupRunId, userId, joinedAt);
        } catch (DataIntegrityViolationException ex) {
            throw new ApiException(ErrorCode.FULL_OR_ALREADY_JOINED, Map.of());
        }
    }

    @Transactional
    public Map<String, Object> leave(long userId, long groupRunId) {
        sessionReferenceRepository
                .lockGroupRun(groupRunId)
                .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
        GroupRunRow row = requireGroupRun(groupRunId);
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(ErrorCode.RUN_ALREADY_STARTED);
        }
        if (row.hostId() == userId) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE_GROUPRUN_LEAVE);
        }
        GroupRunParticipantRow participant =
                participantJdbcRepository
                        .find(groupRunId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.NOT_PARTICIPANT));
        Long sessionId = participant.sessionId();
        // 참가 행을 먼저 지워 세션 연결을 끊은 뒤 취소한다(ready 해제와 같은 잠금 순서).
        participantJdbcRepository.delete(groupRunId, userId);
        groupPaceService.membershipOrGoalChanged(groupRunId);
        if (sessionId != null) {
            runningSessionControlService.cancel(userId, sessionId);
        }
        return Map.of();
    }

    @Transactional(readOnly = true)
    public GroupRunParticipantsResponse listParticipants(long userId, long groupRunId) {
        GroupRunRow row = requireGroupRun(groupRunId);
        requireApprovedActiveCrewMember(row.crewId(), userId);
        List<GroupRunParticipantRow> participants =
                participantJdbcRepository.findByGroupRunId(groupRunId);
        Map<Long, String> nicknames =
                userExistsRepository.findNicknamesByIds(
                        participants.stream().map(GroupRunParticipantRow::userId).toList());
        // readyStatus(대기방 준비 버튼)와 별개로 각 참가자의 최신 준비도를 붙인다. 미산출·미동의는 null.
        Map<Long, BigDecimal> readiness =
                fitJdbcRepository.findLatestReadinessScores(
                        participants.stream().map(GroupRunParticipantRow::userId).toList());
        List<GroupRunParticipantsResponse.Item> items =
                participants.stream()
                        .map(
                                p ->
                                        new GroupRunParticipantsResponse.Item(
                                                p.userId(),
                                                p.sessionId(),
                                                p.joinedAt(),
                                                nicknames.getOrDefault(p.userId(), ""),
                                                p.userId() == row.hostId(),
                                                ReadyStatus.fromReady(p.ready()).name(),
                                                toScore(readiness.get(p.userId()))))
                        .toList();
        // 대기방 인원 = 참가 행 전체(session null 포함). readyCount는 그중 준비 완료(S15P31E105-499).
        int readyCount = (int) participants.stream().filter(GroupRunParticipantRow::ready).count();
        return new GroupRunParticipantsResponse(items, participants.size(), readyCount);
    }

    /**
     * G16. ready=true면 그룹 목표로 READY 세션을 만들어 참가 관계에 연결하고, ready=false면 연결을 끊은 뒤 미시작 세션을 취소한다. 대기방
     * ready 표시와 세션 확보는 같이 두고, G09 START 승인 근거는 연결 세션 상태로 본다.
     */
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public ReadyGroupRunResponse setReady(
            long userId, long groupRunId, ReadyGroupRunRequest request) {
        var row = requireGroupRun(groupRunId);
        requireApprovedActiveCrewMember(row.crewId(), userId);
        var participant =
                participantJdbcRepository
                        .find(groupRunId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.NOT_PARTICIPANT));
        boolean ready = request == null || request.resolvedReady();
        var prepared =
                ready && participant.sessionId() == null
                        ? planPreparation.prepare(userId, goalFromGroup(row))
                        : null;
        var tx = new TransactionTemplate(transactionManager);
        tx.setIsolationLevel(
                org.springframework.transaction.TransactionDefinition.ISOLATION_READ_COMMITTED);
        return tx.execute(status -> setReadyStored(userId, groupRunId, request, prepared));
    }

    private ReadyGroupRunResponse setReadyStored(
            long userId,
            long groupRunId,
            ReadyGroupRunRequest request,
            SessionPlanPreparation.Prepared prepared) {
        sessionReferenceRepository
                .lockGroupRun(groupRunId)
                .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
        GroupRunRow row = requireGroupRun(groupRunId);
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE);
        }
        GroupRunParticipantRow participant =
                participantJdbcRepository
                        .find(groupRunId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.NOT_PARTICIPANT));
        boolean ready = request == null ? true : request.resolvedReady();
        Long sessionId = participant.sessionId();
        if (ready) {
            if (sessionId == null) {
                sessionId =
                        runningSessionService.createReadyForGroupParticipant(
                                userId, goalFromGroup(row), prepared);
            }
            participantJdbcRepository.updateSessionAndReady(groupRunId, userId, sessionId, true);
        } else {
            // 연결을 먼저 끊어 S07 cancel이 그룹 행을 다시 잠그지 않게 한다(이미 이 트랜잭션에서 그룹을 잠근 상태).
            participantJdbcRepository.updateSessionAndReady(groupRunId, userId, null, false);
            if (sessionId != null) {
                runningSessionControlService.cancel(userId, sessionId);
            }
        }
        return new ReadyGroupRunResponse(
                participantJdbcRepository.countByGroupRunId(groupRunId),
                ReadyStatus.fromReady(ready).name(),
                participantJdbcRepository.countReadyByGroupRunId(groupRunId),
                ready ? sessionId : null);
    }

    /**
     * G13. 시작 전 호스트 취소. 그룹 행을 잠근 뒤 SCHEDULED만 CANCELLED로 바꾸고 연결된 READY 세션을 세션 ID 순서로 취소한다. 이미 취소된 그룹은 200으로
     * 재응답한다. 참가 행의 session_id는 유지한다. {@code cancelMessage}는 길이만 검증하며, 최초 취소 시 크루 APPROVED 멤버(취소자 제외)에게
     * 인박스 알림 본문으로 전달한다.
     */
    @Transactional
    public CancelGroupRunResponse cancel(
            long userId, long groupRunId, CancelGroupRunRequest request) {
        GroupRunCancelReason reason = parseCancelReason(request.cancelReason());
        GroupRunRow existing = requireGroupRun(groupRunId);
        if (existing.hostId() != userId) {
            throw new ApiException(ErrorCode.NOT_HOST_GROUPRUN_CANCEL);
        }
        lockGroupRunOrThrow(groupRunId);
        GroupRunRow row = requireGroupRun(groupRunId);
        if (row.hostId() != userId) {
            throw new ApiException(ErrorCode.NOT_HOST_GROUPRUN_CANCEL);
        }
        if (GroupRunStatus.CANCELLED.name().equals(row.status())) {
            return new CancelGroupRunResponse(groupRunId, GroupRunStatus.CANCELLED.name());
        }
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE_GROUPRUN_CANCEL);
        }
        groupRunJdbcRepository.markCancelled(groupRunId, reason.name());
        notifyParticipationCancelled(userId, groupRunId, row.crewId(), request.cancelMessage());
        // 그룹을 이미 잠갔으므로 S07 cancel의 그룹 재잠금은 같은 트랜잭션에서 통과한다. 참가 행의 session_id는 유지한다.
        participantJdbcRepository.findByGroupRunId(groupRunId).stream()
                .filter(p -> p.sessionId() != null)
                .sorted(Comparator.comparingLong(GroupRunParticipantRow::sessionId))
                .forEach(p -> runningSessionControlService.cancel(p.userId(), p.sessionId()));
        return new CancelGroupRunResponse(groupRunId, GroupRunStatus.CANCELLED.name());
    }

    private void notifyParticipationCancelled(
            long cancellerUserId, long groupRunId, long crewId, String cancelMessage) {
        String message =
                cancelMessage == null || cancelMessage.isBlank()
                        ? "그룹런이 취소되었습니다."
                        : cancelMessage;
        crewMembershipRepository
                .findByCrewIdAndStatus(crewId, CrewMembershipStatus.APPROVED)
                .stream()
                .map(CrewMembership::getUserId)
                .filter(recipientId -> recipientId != cancellerUserId)
                .forEach(
                        recipientId ->
                                notificationService.create(
                                        recipientId,
                                        NotificationType.GROUP_RUN_PARTICIPATION_CANCELLED,
                                        groupRunId,
                                        message,
                                        NotificationType.GROUP_RUN_PARTICIPATION_CANCELLED.name()
                                                + ":"
                                                + groupRunId
                                                + ":"
                                                + recipientId));
    }

    /**
     * G09. 호스트만 본문 없이 호출한다. 이미 승인한 시작이 있으면 최초 START 명령을 그대로 돌려주고, 새 승인은 SCHEDULED 그룹의 연결된 READY 세션
     * 전체를 한 트랜잭션으로 승인한 뒤 그룹을 RUNNING으로 바꾼다. 하나라도 실패하면 전체 롤백한다. 새 개인 세션을 자동 생성하지 않는다.
     */
    @Transactional
    public StartGroupRunResponse start(long userId, long groupRunId) {
        GroupRunRow existing = requireGroupRun(groupRunId);
        if (existing.hostId() != userId) {
            throw new ApiException(ErrorCode.NOT_HOST_GROUPRUN_START);
        }
        lockGroupRunOrThrow(groupRunId);
        GroupRunRow row = requireGroupRun(groupRunId);
        if (row.hostId() != userId) {
            throw new ApiException(ErrorCode.NOT_HOST_GROUPRUN_START);
        }
        List<GroupRunParticipantRow> linked =
                participantJdbcRepository.findByGroupRunId(groupRunId).stream()
                        .filter(p -> p.sessionId() != null)
                        .sorted(Comparator.comparingLong(GroupRunParticipantRow::sessionId))
                        .toList();

        List<GroupStartCommand> replay =
                runningSessionControlService.findGroupStartCommands(
                        linked.stream().map(GroupRunParticipantRow::sessionId).toList());
        if (!replay.isEmpty()) {
            return toStartResponse(replay);
        }
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE_GROUPRUN_START);
        }

        SessionGoal groupGoal = goalFromGroup(row);
        List<GroupStartCommand> approved = new ArrayList<>();
        for (GroupRunParticipantRow participant : linked) {
            runningSessionControlService
                    .approveGroupStart(participant.userId(), participant.sessionId(), groupGoal)
                    .ifPresent(approved::add);
        }
        if (approved.isEmpty()) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE_GROUPRUN_START);
        }
        if (groupRunJdbcRepository.markRunning(groupRunId) != 1) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE_GROUPRUN_START);
        }
        return toStartResponse(approved);
    }

    /**
     * G12. 호스트만 호출한다. 그룹 행을 잠근 뒤 RUNNING 그룹을 COMPLETED로 바꾸고 종료 기준시각을 한 번 저장한다. 이미 종료 시각이 있는 그룹은 같은
     * 시각을 200으로 재응답하며 세션을 다시 건드리지 않는다. 연결 세션은 세션 ID 오름차순으로 처리한다: 미확정 START는 중단하고, 시작된 세션에는 현재 제어기기의
     * END를 승인한다(다른 미확정 제어가 있으면 보류하되 그룹 종료는 막지 않는다).
     */
    @Transactional
    public ForceFinishGroupRunResponse forceFinish(long userId, long groupRunId) {
        GroupRunRow existing = requireGroupRun(groupRunId);
        if (existing.hostId() != userId) {
            throw new ApiException(ErrorCode.NOT_HOST_GROUPRUN_FORCE_FINISH);
        }
        SessionReferenceRepository.GroupRunState state =
                sessionReferenceRepository
                        .lockGroupRun(groupRunId)
                        .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
        if (state.isCompleted() && state.endedAt() != null) {
            return new ForceFinishGroupRunResponse(
                    groupRunId, GroupRunStatus.COMPLETED.name(), state.endedAt());
        }
        if (!GroupRunStatus.RUNNING.name().equals(state.status())) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE_GROUPRUN_FORCE_FINISH);
        }
        // 호스트 권한은 잠금 전 값으로 한 번 확인했다. 호스트는 변경되지 않지만 잠금 후 행으로 다시 확인한다.
        if (requireGroupRun(groupRunId).hostId() != userId) {
            throw new ApiException(ErrorCode.NOT_HOST_GROUPRUN_FORCE_FINISH);
        }
        Instant endedAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
        if (groupRunJdbcRepository.markCompleted(groupRunId, endedAt) != 1) {
            throw new ApiException(ErrorCode.INVALID_GROUP_STATE_GROUPRUN_FORCE_FINISH);
        }
        participantJdbcRepository.findByGroupRunId(groupRunId).stream()
                .filter(p -> p.sessionId() != null)
                .map(GroupRunParticipantRow::sessionId)
                .sorted()
                .forEach(runningSessionControlService::forceFinishGroupParticipant);
        return new ForceFinishGroupRunResponse(
                groupRunId, GroupRunStatus.COMPLETED.name(), endedAt);
    }

    /**
     * G14. 참가자만 읽는다. 종료·분석을 실행하지 않고 현재 저장된 값만 돌려준다. 시작이 확인되지 않은 참가자의 측정값은 null이다. 그룹 분석 상태는 저장하지 않고
     * 참가자 상태에서 파생한다.
     */
    @Transactional(readOnly = true)
    public GroupRunResultsResponse getResults(long userId, long groupRunId) {
        GroupRunRow row = requireGroupRun(groupRunId);
        requireParticipant(groupRunId, userId);

        List<GroupResultRow> rows = sessionReferenceRepository.findGroupResultRows(groupRunId);
        boolean hasUnconfirmedStarts = false;
        boolean unfinishedStarted = false;
        boolean anyFailed = false;
        boolean allSettled = true;
        List<GroupRunResultsResponse.Participant> participants = new ArrayList<>();
        for (GroupResultRow r : rows) {
            boolean started = r.startedAt() != null;
            if (r.startResult() != null
                    && ("PENDING".equals(r.startResult()) || "UNKNOWN".equals(r.startResult()))
                    && !started
                    && !"INTERRUPTED".equals(r.sessionStatus())) {
                hasUnconfirmedStarts = true;
            }
            if (started) {
                if ("RUNNING".equals(r.sessionStatus()) || "PAUSED".equals(r.sessionStatus())) {
                    unfinishedStarted = true;
                }
                if ("FAILED".equals(r.analysisStatus())) {
                    anyFailed = true;
                } else if (!"READY".equals(r.analysisStatus())
                        && !"LEGACY".equals(r.analysisStatus())) {
                    allSettled = false;
                }
            }
            participants.add(
                    new GroupRunResultsResponse.Participant(
                            r.userId(),
                            r.sessionId(),
                            r.startResult(),
                            r.sessionStatus(),
                            started
                                    ? new GroupRunResultsResponse.Analysis(r.analysisStatus())
                                    : null,
                            started && r.totalDistance() != null
                                    ? r.totalDistance().doubleValue()
                                    : null,
                            started ? r.movingDuration() : null,
                            started && r.averagePace() != null
                                    ? r.averagePace().doubleValue()
                                    : null,
                            started ? r.goalAchieved() : null));
        }
        String analysisStatus;
        if (hasUnconfirmedStarts || unfinishedStarted) {
            analysisStatus = "PROCESSING";
        } else if (anyFailed) {
            analysisStatus = "FAILED";
        } else if (allSettled) {
            analysisStatus = "READY";
        } else {
            analysisStatus = "PROCESSING";
        }
        // 집계 대상: 시작 확인(startedAt) + 실제 거리 있음. 참가자 목록은 시작·거리가 없으면 거리 null이므로 그 값으로 거른다.
        List<Double> eligibleDistances = new ArrayList<>();
        List<Double> eligiblePaces = new ArrayList<>();
        for (GroupRunResultsResponse.Participant p : participants) {
            if (p.actualDistanceM() != null) {
                eligibleDistances.add(p.actualDistanceM());
                eligiblePaces.add(p.averagePaceSecPerKm());
            }
        }
        GroupResultAggregates.Result aggregates =
                GroupResultAggregates.of(
                        "READY".equals(analysisStatus), eligibleDistances, eligiblePaces);
        return new GroupRunResultsResponse(
                groupRunId,
                row.goalDistance(),
                row.goalDuration(),
                new GroupRunResultsResponse.Analysis(analysisStatus),
                hasUnconfirmedStarts,
                aggregates.distanceM(),
                aggregates.averagePaceSecPerKm(),
                aggregates.maxGapM(),
                participants);
    }

    /**
     * G10 실시간 순위·앞뒤 격차 조회(MVP). 요청 시점의 최신 스냅샷을 읽어 파생 계산만 하며 상태 변경·이벤트·알림 같은 부수 효과가 없다. RUNNING이 아닌
     * 그룹은 순위·격차를 모두 null로 돌려준다.
     */
    @Transactional(readOnly = true)
    public GroupRunLiveResponse getLive(long userId, long groupRunId) {
        GroupRunRow row = requireGroupRun(groupRunId);
        requireParticipant(groupRunId, userId);
        Integer guidePace = resolveGroupGuidePace(row);
        List<GroupRunLiveResponse.Participant> participants;
        GroupRunLiveResponse.LoadAlert loadAlert = null;
        if (GroupRunStatus.RUNNING.name().equals(row.status())) {
            participants = computeLiveParticipants(row);
            loadAlert =
                    GroupRunLoadAlertCalculator.evaluate(
                            guidePace,
                            participants.stream()
                                    .filter(p -> !p.stale())
                                    .map(GroupRunLiveResponse.Participant::paceSecPerKm)
                                    .toList());
            var stored = groupPaceService.stored(groupRunId).filter(s -> s.pace() != null);
            if (stored.isPresent()) {
                var state = stored.get();
                guidePace = state.pace();
                loadAlert = state.strugglingCount() > 0
                        ? new GroupRunLiveResponse.LoadAlert(state.strugglingCount(), state.pace())
                        : null;
            }
        } else {
            participants =
                    participantJdbcRepository.findByGroupRunId(groupRunId).stream()
                            .map(p -> unrankedParticipant(p.userId()))
                            .toList();
        }
        return new GroupRunLiveResponse(
                groupRunId,
                row.status(),
                guidePace,
                row.courseId(),
                row.updatedAt(),
                loadAlert,
                participants);
    }

    /** 공동 추천 페이스. 목표 환산과 분리. RUNNING은 AI04/실측 중앙값, 부족 시·그 외 상태는 참가자 프로필 평균 페이스 중앙값. */
    private Integer resolveGroupGuidePace(GroupRunRow row) {
        var stored = groupPaceService.stored(row.id());
        if (stored.isPresent()) {
            Integer pace = "SCHEDULED".equals(row.status())
                    ? stored.get().startPace()
                    : "RUNNING".equals(row.status()) ? stored.get().pace() : null;
            if (pace != null) return pace;
        }
        if (GroupRunStatus.RUNNING.name().equals(row.status())) {
            Instant measuredAtCeiling =
                    Instant.now()
                            .plusSeconds(GroupRunLiveRanking.MEASURED_AT_FUTURE_SKEW_SECONDS);
            Integer running =
                    GroupGuidePaceCalculator.medianSecPerKmFromBigDecimals(
                            participantJdbcRepository.findRunningParticipantGuidePaces(
                                    row.id(), measuredAtCeiling));
            if (running != null) {
                return running;
            }
        }
        return GroupGuidePaceCalculator.medianSecPerKmFromBigDecimals(
                participantJdbcRepository.findParticipantProfilePaces(row.id()));
    }

    private List<GroupRunLiveResponse.Participant> computeLiveParticipants(GroupRunRow row) {
        Instant now = Instant.now();
        Instant measuredAtCeiling =
                now.plusSeconds(GroupRunLiveRanking.MEASURED_AT_FUTURE_SKEW_SECONDS);
        // MVP: GPS 궤적은 읽지 않고 빈 목록을 넘긴다. 자유 그룹도 누적 거리만으로 순위를 매긴다(선두 궤적 투영은 확장).
        // 미래 시각 표본은 ceiling 이하만 고르므로 이후 정상 표본을 가리지 않는다.
        // 신선도는 종류와 무관한 최신 측정 표본으로 판단한다. 멈춰 서 있으면 워치가 거리 표본을 보내지 않기 때문이다.
        List<SessionReferenceRepository.GroupLiveRow> liveRows =
                sessionReferenceRepository.findGroupLiveRows(row.id(), measuredAtCeiling);
        Map<Long, Integer> paceByUser = new HashMap<>();
        for (SessionReferenceRepository.GroupLiveRow r : liveRows) {
            paceByUser.put(
                    r.userId(),
                    GroupRunLivePaceCalculator.fromAverageSpeedMps(r.averageSpeedMps()));
        }
        List<ParticipantSample> samples =
                liveRows.stream()
                        .map(
                                r ->
                                        new ParticipantSample(
                                                r.userId(),
                                                r.startedAt() != null
                                                        && "RUNNING".equals(r.sessionStatus()),
                                                r.totalDistance() == null
                                                        ? null
                                                        : r.totalDistance().doubleValue(),
                                                r.measuredAt(),
                                                List.of(),
                                                r.lastSampleAt()))
                        .toList();
        Double courseDistanceM = null;
        if (row.courseId() != null) {
            courseDistanceM =
                    courseJdbcRepository
                            .findById(row.courseId())
                            .map(CourseRow::distanceM)
                            .map(BigDecimal::doubleValue)
                            .orElse(null);
        }
        return GroupRunLiveRanking.compute(now, row.courseId() != null, courseDistanceM, samples)
                .stream()
                .map(live -> toLiveParticipant(live, paceByUser.get(live.userId())))
                .toList();
    }

    /**
     * 순위 집합 밖(미시작·일시정지·거리 표본 없음·최신 측정 표본 TTL 초과·미래 시각)은 stale로 표시해 순위 0 같은 값으로 채우지 않는다.
     * paceSecPerKm은 최신 측정 표본 기준 최근 60초 실측 페이스이며 stale이면 null이다.
     */
    private static GroupRunLiveResponse.Participant toLiveParticipant(
            ParticipantLive live, Integer livePaceSecPerKm) {
        return new GroupRunLiveResponse.Participant(
                live.userId(),
                live.rank(),
                live.aheadCount(),
                live.behindCount(),
                live.gapToAheadM(),
                live.gapToBehindM(),
                live.progressM(),
                live.stale() ? null : livePaceSecPerKm,
                live.measuredAt(),
                live.stale());
    }

    private static GroupRunLiveResponse.Participant unrankedParticipant(long userId) {
        return new GroupRunLiveResponse.Participant(
                userId, null, null, null, null, null, null, null, null, true);
    }

    private void requireParticipant(long groupRunId, long userId) {
        if (!participantJdbcRepository.exists(groupRunId, userId)) {
            throw new ApiException(ErrorCode.NOT_PARTICIPANT);
        }
    }

    private static StartGroupRunResponse toStartResponse(List<GroupStartCommand> commands) {
        return new StartGroupRunResponse(
                commands.stream()
                        .map(
                                c ->
                                        new StartGroupRunResponse.Item(
                                                c.sessionId(),
                                                c.commandId(),
                                                c.result(),
                                                c.expectedVersion(),
                                                c.startedAt()))
                        .toList());
    }

    private void lockGroupRunOrThrow(long groupRunId) {
        sessionReferenceRepository
                .lockGroupRun(groupRunId)
                .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
    }

    private static GroupRunCancelReason parseCancelReason(String value) {
        try {
            return GroupRunCancelReason.valueOf(value.trim());
        } catch (IllegalArgumentException | NullPointerException ex) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR_GROUPRUN_CANCEL_REASON);
        }
    }

    private static SessionGoal goalFromGroup(GroupRunRow row) {
        return new SessionGoal(row.courseId(), null, row.goalDistance(), row.goalDuration(), null);
    }

    private void requireApprovedActiveCrewMember(long crewId, long userId) {
        Crew crew =
                crewRepository
                        .findById(crewId)
                        .orElseThrow(() -> new ApiException(ErrorCode.CREW_FORBIDDEN));
        if (crew.getStatus() != CrewStatus.ACTIVE) {
            throw new ApiException(
                    ErrorCode.CREW_FORBIDDEN_GROUPRUN_REQUIRE_APPROVED_ACTIVE_CREW_MEMBER);
        }
        Optional<CrewMembership> membership =
                crewMembershipRepository.findByCrewIdAndUserId(crewId, userId);
        if (membership.isEmpty() || membership.get().getStatus() != CrewMembershipStatus.APPROVED) {
            throw new ApiException(ErrorCode.CREW_FORBIDDEN);
        }
    }

    private Integer requireAssignableCourseDistance(long courseId) {
        CourseRow course =
                courseJdbcRepository
                        .findById(courseId)
                        .orElseThrow(GroupRunService::courseNotFound);
        if ("MERGED".equals(course.status()) || "BLOCKED".equals(course.status())) {
            throw new ApiException(ErrorCode.COURSE_INACCESSIBLE);
        }
        if (!"ACTIVE".equals(course.status())) {
            throw new ApiException(ErrorCode.COURSE_INACCESSIBLE);
        }
        if (course.distanceM() == null) {
            throw courseNotFound();
        }
        return course.distanceM().intValue();
    }

    private GroupRunRow requireGroupRun(long groupRunId) {
        return groupRunJdbcRepository
                .findById(groupRunId)
                .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
    }

    private GroupRunDetailResponse toDetail(
            GroupRunRow row,
            int participantCount,
            GroupRunDetailResponse.ComfortRange comfortRange,
            GroupRunDetailResponse.MyFit myFit) {
        return new GroupRunDetailResponse(
                row.id(),
                row.title(),
                row.description(),
                row.hostId(),
                row.crewId(),
                row.courseId(),
                row.scheduledAt(),
                parseMeetingPosition(row.meetingPositionGeoJson()),
                participantCount,
                row.status(),
                row.goalDistance(),
                row.goalDuration(),
                row.meetingName(),
                row.meetingAddress(),
                GroupRunGoalCalculator.derivePaceSecPerKm(row.goalDistance(), row.goalDuration()),
                resolveGroupGuidePace(row),
                toCancellation(row),
                comfortRange,
                myFit);
    }

    /** CANCELLED 그룹만 취소 정보를 만든다. 남긴 말은 저장하지 않으므로 null, 취소자는 host_id 기준 HOST다. */
    private GroupRunDetailResponse.Cancellation toCancellation(GroupRunRow row) {
        if (!GroupRunStatus.CANCELLED.name().equals(row.status()) || row.cancelReason() == null) {
            return null;
        }
        String hostNickname = userExistsRepository.findNickname(row.hostId()).orElse(null);
        return new GroupRunDetailResponse.Cancellation(
                row.cancelReason(), null, hostNickname, "HOST");
    }

    private GeoJsonPoint parseMeetingPosition(String geoJson) {
        if (geoJson == null || geoJson.isBlank()) {
            return null;
        }
        try {
            return jsonMapper.readValue(geoJson, GeoJsonPoint.class);
        } catch (Exception ex) {
            throw new ApiException(ErrorCode.GROUP_MEETING_POSITION_ERROR);
        }
    }

    private static void rejectPartialGoalNullRelease(PatchGroupRunRequest request) {
        if ((request.targetDistanceMPresent() && request.targetDistanceM() == null)
                || (request.targetDurationSecPresent() && request.targetDurationSec() == null)
                || (request.targetPaceSecPerKmPresent() && request.targetPaceSecPerKm() == null)
                || (request.goalInputTypePresent() && request.goalInputType() == null)) {
            throw new ApiException(
                    ErrorCode.INVALID_GOAL_GROUPRUN_REJECT_PARTIAL_GOAL_NULL_RELEASE);
        }
    }

    private static String requireNonBlankTitle(String title) {
        if (title == null || title.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_REQUIRED_FIELD, "title");
        }
        return title.trim();
    }

    private static String requireNonBlankMeetingName(String name) {
        if (name == null || name.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_REQUIRED_FIELD, "meetingPlaceName");
        }
        return name.trim();
    }

    private static java.time.Instant requireScheduledAt(java.time.Instant scheduledAt) {
        if (scheduledAt == null) {
            throw new ApiException(ErrorCode.VALIDATION_REQUIRED_FIELD, "scheduledAt");
        }
        return scheduledAt;
    }

    private static GeoJsonPoint requireMeetingPosition(GeoJsonPoint position) {
        if (position == null) {
            throw new ApiException(ErrorCode.VALIDATION_REQUIRED_FIELD, "meetingPosition");
        }
        return position;
    }

    private static String normalizeStatusFilter(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        try {
            return GroupRunStatus.valueOf(status.trim()).name();
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.INVALID_FILTER_GROUPRUN_NORMALIZE_STATUS_FILTER);
        }
    }

    private static String normalizeParticipation(String participation) {
        if (participation == null || participation.isBlank()) {
            return null;
        }
        String value = participation.trim();
        if (!"ME".equals(value) && !"NONE".equals(value)) {
            throw new ApiException(ErrorCode.INVALID_FILTER_GROUPRUN_NORMALIZE_PARTICIPATION);
        }
        return value;
    }

    private static void validateGeoFilter(Double latitude, Double longitude, Double radiusM) {
        boolean any = latitude != null || longitude != null || radiusM != null;
        if (!any) {
            return;
        }
        if (latitude == null || longitude == null || radiusM == null) {
            throw new ApiException(ErrorCode.GROUP_GEO_FILTER_INCOMPLETE);
        }
        if (radiusM <= 0) {
            throw new ApiException(ErrorCode.GROUP_GEO_RADIUS_INVALID);
        }
        try {
            GeoJsonPoint.of(longitude, latitude);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.GROUP_GEO_COORDINATES_INVALID);
        }
    }

    private static int resolveLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new ApiException(
                    ErrorCode.INVALID_FILTER_GROUPRUN_RESOLVE_LIMIT, String.valueOf(MAX_LIMIT));
        }
        return limit;
    }

    private static Long parseCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            long value = Long.parseLong(cursor.trim());
            if (value < 1) {
                throw invalidCursor();
            }
            return value;
        } catch (NumberFormatException ex) {
            throw invalidCursor();
        }
    }

    private static ApiException invalidCursor() {
        return new ApiException(ErrorCode.INVALID_FILTER_GROUPRUN_INVALID_CURSOR);
    }

    private static ApiException courseNotFound() {
        return new ApiException(ErrorCode.COURSE_NOT_FOUND);
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }
}
