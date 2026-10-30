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
import com.runway.backend.domain.grouprun.dto.request.CreateGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.PatchGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.ReadyGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.response.CreateGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunDetailResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunListResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunParticipantsResponse;
import com.runway.backend.domain.grouprun.dto.response.JoinGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.PatchGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.ReadyGroupRunResponse;
import com.runway.backend.domain.grouprun.entity.GroupRunStatus;
import com.runway.backend.domain.grouprun.entity.ReadyStatus;
import com.runway.backend.domain.grouprun.helper.GroupRunGoalCalculator;
import com.runway.backend.domain.grouprun.helper.GroupRunGoalCalculator.ResolvedGoals;
import com.runway.backend.domain.grouprun.repository.GroupRunJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunParticipantJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunParticipantRow;
import com.runway.backend.domain.grouprun.repository.GroupRunRow;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
@RequiredArgsConstructor
public class GroupRunService {

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final GroupRunJdbcRepository groupRunJdbcRepository;
    private final GroupRunParticipantJdbcRepository participantJdbcRepository;
    private final CrewRepository crewRepository;
    private final CrewMembershipRepository crewMembershipRepository;
    private final CourseJdbcRepository courseJdbcRepository;
    private final UserExistsRepository userExistsRepository;
    private final JsonMapper jsonMapper;

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
        int participantCount = participantJdbcRepository.countByGroupRunId(groupRunId);
        return toDetail(row, participantCount);
    }

    @Transactional
    public PatchGroupRunResponse patch(long userId, long groupRunId, PatchGroupRunRequest request) {
        GroupRunRow row = requireGroupRun(groupRunId);
        if (row.hostId() != userId) {
            throw new ApiException(HttpStatus.FORBIDDEN, "NOT_HOST", "그룹장만 수정할 수 있습니다.");
        }
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(
                    HttpStatus.CONFLICT, "EDIT_NOT_ALLOWED", "출발 전 그룹런만 수정할 수 있습니다.");
        }

        String title =
                request.titlePresent()
                        ? requireNonBlankTitle(request.title())
                        : row.title();
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
                            request.targetDurationSecPresent()
                                    ? request.targetDurationSec()
                                    : null,
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
            throw new ApiException(
                    HttpStatus.CONFLICT, "INVALID_GROUP_STATE", "모집 중인 그룹런에만 참가할 수 있습니다.");
        }
        try {
            var joinedAt = participantJdbcRepository.insert(groupRunId, userId, false);
            return new JoinGroupRunResponse(groupRunId, userId, joinedAt);
        } catch (DataIntegrityViolationException ex) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "FULL_OR_ALREADY_JOINED",
                    "이미 참가한 그룹런입니다.",
                    Map.of());
        }
    }

    @Transactional
    public Map<String, Object> leave(long userId, long groupRunId) {
        GroupRunRow row = requireGroupRun(groupRunId);
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(
                    HttpStatus.CONFLICT, "RUN_ALREADY_STARTED", "출발 전에만 참가를 취소할 수 있습니다.");
        }
        if (row.hostId() == userId) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "INVALID_GROUP_STATE",
                    "그룹장은 참가 취소 대신 그룹런 취소를 사용해야 합니다.");
        }
        if (!participantJdbcRepository.exists(groupRunId, userId)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN, "NOT_PARTICIPANT", "참가하지 않은 그룹런입니다.");
        }
        participantJdbcRepository.delete(groupRunId, userId);
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
                                                ReadyStatus.fromReady(p.ready()).name()))
                        .toList();
        return new GroupRunParticipantsResponse(items);
    }

    @Transactional
    public ReadyGroupRunResponse setReady(
            long userId, long groupRunId, ReadyGroupRunRequest request) {
        GroupRunRow row = requireGroupRun(groupRunId);
        if (!GroupRunStatus.SCHEDULED.name().equals(row.status())) {
            throw new ApiException(
                    HttpStatus.CONFLICT, "INVALID_GROUP_STATE", "출발 전 대기방에서만 준비를 변경할 수 있습니다.");
        }
        if (!participantJdbcRepository.exists(groupRunId, userId)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN, "NOT_PARTICIPANT", "참가하지 않은 그룹런입니다.");
        }
        boolean ready = request == null ? true : request.resolvedReady();
        participantJdbcRepository.updateReady(groupRunId, userId, ready);
        return new ReadyGroupRunResponse(
                participantJdbcRepository.countByGroupRunId(groupRunId),
                ReadyStatus.fromReady(ready).name(),
                participantJdbcRepository.countReadyByGroupRunId(groupRunId));
    }

    private void requireApprovedActiveCrewMember(long crewId, long userId) {
        Crew crew =
                crewRepository
                        .findById(crewId)
                        .orElseThrow(
                                () ->
                                        new ApiException(
                                                HttpStatus.FORBIDDEN,
                                                "CREW_FORBIDDEN",
                                                "크루 멤버만 이용할 수 있습니다."));
        if (crew.getStatus() != CrewStatus.ACTIVE) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN, "CREW_FORBIDDEN", "활성 크루의 멤버만 이용할 수 있습니다.");
        }
        Optional<CrewMembership> membership =
                crewMembershipRepository.findByCrewIdAndUserId(crewId, userId);
        if (membership.isEmpty()
                || membership.get().getStatus() != CrewMembershipStatus.APPROVED) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN, "CREW_FORBIDDEN", "크루 멤버만 이용할 수 있습니다.");
        }
    }

    private Integer requireAssignableCourseDistance(long courseId) {
        CourseRow course =
                courseJdbcRepository.findById(courseId).orElseThrow(GroupRunService::courseNotFound);
        if ("MERGED".equals(course.status()) || "BLOCKED".equals(course.status())) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN, "COURSE_INACCESSIBLE", "사용할 수 없는 코스입니다.");
        }
        if (!"ACTIVE".equals(course.status())) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN, "COURSE_INACCESSIBLE", "사용할 수 없는 코스입니다.");
        }
        if (course.distanceM() == null) {
            throw courseNotFound();
        }
        return course.distanceM().intValue();
    }

    private GroupRunRow requireGroupRun(long groupRunId) {
        return groupRunJdbcRepository
                .findById(groupRunId)
                .orElseThrow(
                        () ->
                                new ApiException(
                                        HttpStatus.NOT_FOUND,
                                        "GROUP_NOT_FOUND",
                                        "그룹런을 찾을 수 없습니다."));
    }

    private GroupRunDetailResponse toDetail(GroupRunRow row, int participantCount) {
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
                GroupRunGoalCalculator.derivePaceSecPerKm(row.goalDistance(), row.goalDuration()));
    }

    private GeoJsonPoint parseMeetingPosition(String geoJson) {
        if (geoJson == null || geoJson.isBlank()) {
            return null;
        }
        try {
            return jsonMapper.readValue(geoJson, GeoJsonPoint.class);
        } catch (Exception ex) {
            throw new ApiException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "모임 위치를 읽을 수 없습니다.");
        }
    }

    private static void rejectPartialGoalNullRelease(PatchGroupRunRequest request) {
        if ((request.targetDistanceMPresent() && request.targetDistanceM() == null)
                || (request.targetDurationSecPresent() && request.targetDurationSec() == null)
                || (request.targetPaceSecPerKmPresent() && request.targetPaceSecPerKm() == null)
                || (request.goalInputTypePresent() && request.goalInputType() == null)) {
            throw new ApiException(
                    HttpStatus.UNPROCESSABLE_CONTENT,
                    "INVALID_GOAL",
                    "부분 목표 해제는 지원하지 않습니다.");
        }
    }

    private static String requireNonBlankTitle(String title) {
        if (title == null || title.isBlank()) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "title은 필수입니다.");
        }
        return title.trim();
    }

    private static String requireNonBlankMeetingName(String name) {
        if (name == null || name.isBlank()) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "meetingPlaceName은 필수입니다.");
        }
        return name.trim();
    }

    private static java.time.Instant requireScheduledAt(java.time.Instant scheduledAt) {
        if (scheduledAt == null) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "scheduledAt은 필수입니다.");
        }
        return scheduledAt;
    }

    private static GeoJsonPoint requireMeetingPosition(GeoJsonPoint position) {
        if (position == null) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "meetingPosition은 필수입니다.");
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
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FILTER",
                    "status는 SCHEDULED, RUNNING, COMPLETED, CANCELLED만 허용됩니다.");
        }
    }

    private static String normalizeParticipation(String participation) {
        if (participation == null || participation.isBlank()) {
            return null;
        }
        String value = participation.trim();
        if (!"ME".equals(value) && !"NONE".equals(value)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "INVALID_FILTER", "participation은 ME 또는 NONE만 허용됩니다.");
        }
        return value;
    }

    private static void validateGeoFilter(Double latitude, Double longitude, Double radiusM) {
        boolean any = latitude != null || longitude != null || radiusM != null;
        if (!any) {
            return;
        }
        if (latitude == null || longitude == null || radiusM == null) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FILTER",
                    "근처 검색은 latitude, longitude, radiusM을 모두 지정해야 합니다.");
        }
        if (radiusM <= 0) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "INVALID_FILTER", "radiusM은 양수여야 합니다.");
        }
        try {
            GeoJsonPoint.of(longitude, latitude);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "INVALID_FILTER", "위도·경도 값이 올바르지 않습니다.");
        }
    }

    private static int resolveLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FILTER",
                    "limit은 1 이상 " + MAX_LIMIT + " 이하여야 합니다.");
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
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_FILTER", "cursor가 올바르지 않습니다.");
    }

    private static ApiException courseNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "COURSE_NOT_FOUND", "코스를 찾을 수 없습니다.");
    }

    private static String blankToNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }
}
