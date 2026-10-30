package com.runway.backend.domain.crew.controller;

import com.runway.backend.domain.crew.dto.request.CreateCrewRequest;
import com.runway.backend.domain.crew.dto.request.DecideJoinRequest;
import com.runway.backend.domain.crew.dto.request.LeaveCrewRequest;
import com.runway.backend.domain.crew.dto.response.CrewCreateResponse;
import com.runway.backend.domain.crew.dto.response.CrewDetailResponse;
import com.runway.backend.domain.crew.dto.response.CrewDissolveResponse;
import com.runway.backend.domain.crew.dto.response.CrewListResponse;
import com.runway.backend.domain.crew.dto.response.DecideJoinResponse;
import com.runway.backend.domain.crew.dto.response.JoinRequestListResponse;
import com.runway.backend.domain.crew.dto.response.JoinRequestResponse;
import com.runway.backend.domain.crew.dto.response.MemberLeaveResponse;
import com.runway.backend.domain.crew.dto.response.MemberListResponse;
import com.runway.backend.domain.crew.service.CrewService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.Valid;
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
@RequestMapping("/api/v1/crews")
@RequiredArgsConstructor
public class CrewController {

    private final CrewService crewService;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CrewCreateResponse create(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody CreateCrewRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return crewService.create(userId, request);
    }

    @GetMapping("/{crewId}")
    public CrewDetailResponse getDetail(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long crewId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return crewService.getDetail(userId, crewId);
    }

    @GetMapping
    public CrewListResponse search(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String regionCode) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return crewService.search(userId, q, regionCode);
    }

    @PostMapping("/{crewId}/join-requests")
    public JoinRequestResponse createJoinRequest(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long crewId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return crewService.createJoinRequest(userId, crewId);
    }

    @GetMapping("/{crewId}/join-requests")
    public JoinRequestListResponse listJoinRequests(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long crewId,
            @RequestParam(required = false) String status) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return crewService.listJoinRequests(userId, crewId, status);
    }

    @PatchMapping("/{crewId}/join-requests/{userId}")
    public DecideJoinResponse decideJoinRequest(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long crewId,
            @PathVariable long userId,
            @Valid @RequestBody DecideJoinRequest request) {
        long ownerUserId = CurrentUserIdResolver.requireUserId(user);
        return crewService.decideJoinRequest(ownerUserId, crewId, userId, request);
    }

    @GetMapping("/{crewId}/members")
    public MemberListResponse listMembers(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long crewId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return crewService.listMembers(userId, crewId);
    }

    @DeleteMapping("/{crewId}/members/me")
    public MemberLeaveResponse leave(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long crewId,
            @RequestBody(required = false) LeaveCrewRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        Long successorUserId = request == null ? null : request.successorUserId();
        return crewService.leave(userId, crewId, successorUserId);
    }

    @DeleteMapping("/{crewId}/members/{userId}")
    public MemberLeaveResponse removeMember(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable long crewId,
            @PathVariable long userId) {
        long ownerUserId = CurrentUserIdResolver.requireUserId(user);
        return crewService.removeMember(ownerUserId, crewId, userId);
    }

    @DeleteMapping("/{crewId}")
    public CrewDissolveResponse dissolve(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long crewId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return crewService.dissolve(userId, crewId);
    }
}
