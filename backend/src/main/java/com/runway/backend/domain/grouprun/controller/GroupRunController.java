package com.runway.backend.domain.grouprun.controller;

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
import com.runway.backend.domain.grouprun.service.GroupRunService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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
            @RequestBody PatchGroupRunRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.patch(userId, groupRunId, request);
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

    @PostMapping("/{groupRunId}/participants/me/ready")
    public ReadyGroupRunResponse ready(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long groupRunId,
            @RequestBody(required = false) ReadyGroupRunRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return groupRunService.setReady(userId, groupRunId, request);
    }
}
