package com.runway.backend.domain.grouprun.controller;

import com.runway.backend.domain.grouprun.dto.request.CancelGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.GroupPaceModeRequest;
import com.runway.backend.domain.grouprun.dto.response.GroupPaceModeResponse;
import com.runway.backend.domain.grouprun.dto.request.CreateGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.PatchGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.ReadyGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.request.JoinNowGroupRunRequest;
import com.runway.backend.domain.grouprun.dto.response.CancelGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.CreateGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunDetailResponse;
import com.runway.backend.domain.grouprun.dto.response.ForceFinishGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunListResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunLiveResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunResultsResponse;
import com.runway.backend.domain.grouprun.dto.response.GroupRunParticipantsResponse;
import com.runway.backend.domain.grouprun.dto.response.JoinGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.PatchGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.ReadyGroupRunResponse;
import com.runway.backend.domain.grouprun.dto.response.StartGroupRunResponse;
import com.runway.backend.domain.grouprun.service.GroupRunService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/group-runs")
@RequiredArgsConstructor
public class GroupRunController {

    private final GroupRunService groupRunService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CreateGroupRunResponse create(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody CreateGroupRunRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.create(userId, request);
    }

    @GetMapping
    public GroupRunListResponse list(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) Long crewId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String participation,
            @RequestParam(required = false) Boolean myCrewsOnly,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) Double radiusM,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.list(
                userId,
                crewId,
                status,
                participation,
                myCrewsOnly,
                latitude,
                longitude,
                radiusM,
                cursor,
                limit);
    }

    @GetMapping("/{groupRunId}")
    public GroupRunDetailResponse detail(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long groupRunId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.getDetail(userId, groupRunId);
    }

    @PatchMapping("/{groupRunId}")
    public PatchGroupRunResponse patch(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long groupRunId,
            @Valid @RequestBody PatchGroupRunRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.patch(userId, groupRunId, request);
    }

    @PutMapping("/{groupRunId}/pace-mode")
    public GroupPaceModeResponse paceMode(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long groupRunId,
            @RequestBody(required = false) GroupPaceModeRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.changePaceMode(userId, groupRunId, request);
    }

    @PostMapping("/{groupRunId}/join")
    public JoinGroupRunResponse join(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long groupRunId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.join(userId, groupRunId);
    }

    @DeleteMapping("/{groupRunId}/participants/me")
    public Map<String, Object> leave(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long groupRunId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.leave(userId, groupRunId);
    }

    @GetMapping("/{groupRunId}/participants")
    public GroupRunParticipantsResponse participants(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long groupRunId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.listParticipants(userId, groupRunId);
    }

    /** G09. 본문이 없는 호스트 전용 시작 승인. */
    @PostMapping("/{groupRunId}/start")
    public StartGroupRunResponse start(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long groupRunId,
            HttpServletRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        if (request.getContentLengthLong() > 0
                || request.getHeader(HttpHeaders.TRANSFER_ENCODING) != null) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        return groupRunService.start(userId, groupRunId);
    }

    @PostMapping("/{groupRunId}/cancel")
    public CancelGroupRunResponse cancel(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long groupRunId,
            @Valid @RequestBody CancelGroupRunRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.cancel(userId, groupRunId, request);
    }

    /** G12. 본문은 빈 객체이며 내용은 사용하지 않는다. */
    @PostMapping("/{groupRunId}/force-finish")
    public ForceFinishGroupRunResponse forceFinish(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long groupRunId,
            @RequestBody(required = false) Map<String, Object> ignored) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.forceFinish(userId, groupRunId);
    }

    /** G14. 읽기 전용 결과 조회. */
    @GetMapping("/{groupRunId}/results")
    public GroupRunResultsResponse results(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long groupRunId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.getResults(userId, groupRunId);
    }

    /** G10 실시간 순위·앞뒤 격차 조회. 읽기 전용. */
    @GetMapping("/{groupRunId}/live")
    public GroupRunLiveResponse live(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long groupRunId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.getLive(userId, groupRunId);
    }

    @PostMapping("/{groupRunId}/participants/me/ready")
    public ReadyGroupRunResponse ready(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long groupRunId,
            @Valid @RequestBody(required = false) ReadyGroupRunRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.setReady(userId, groupRunId, request);
    }
    /** G18. 진행 중인 그룹에 지금 출발하거나 기록 기기를 변경한다. */
    @PostMapping("/{groupRunId}/participants/me/start")
    public StartGroupRunResponse.Item joinNow(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long groupRunId,
            @Valid @RequestBody(required = false) JoinNowGroupRunRequest request) {
        return groupRunService.joinNow(
                CurrentUserIdResolver.requireUserId(user), groupRunId, request);
    }
}
