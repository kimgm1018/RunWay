package com.runway.backend.domain.runningrecord.controller;

import com.runway.backend.domain.runningrecord.dto.response.RunningRecordDetailResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordListResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordPaceTrendResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordSplitsResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordStatisticsResponse;
import com.runway.backend.domain.runningrecord.service.RunningRecordService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/running-records")
@RequiredArgsConstructor
public class RunningRecordController {

    private final RunningRecordService runningRecordService;

    @GetMapping
    public RunningRecordListResponse list(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) Long courseId,
            @RequestParam(required = false) String runType,
            @RequestParam(required = false) String sort) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return runningRecordService.list(
                userId, cursor, limit, from, to, courseId, runType, sort);
    }

    /** H06 — literal path before {@code /{sessionId}} to avoid path-variable capture. */
    @GetMapping("/statistics")
    public RunningRecordStatisticsResponse statistics(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam String period,
            @RequestParam(required = false) String baseDate,
            @RequestParam(required = false) String runType) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return runningRecordService.getStatistics(userId, period, baseDate, runType);
    }

    /** H07 — literal path before {@code /{sessionId}}. */
    @GetMapping("/statistics/pace-trend")
    public RunningRecordPaceTrendResponse paceTrend(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) Integer months) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return runningRecordService.getPaceTrend(userId, months);
    }

    @GetMapping("/{sessionId}")
    public RunningRecordDetailResponse detail(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long sessionId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return runningRecordService.getDetail(userId, sessionId);
    }

    @GetMapping("/{sessionId}/splits")
    public RunningRecordSplitsResponse splits(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable long sessionId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return runningRecordService.getSplits(userId, sessionId);
    }
}
