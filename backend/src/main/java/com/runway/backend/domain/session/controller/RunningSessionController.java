package com.runway.backend.domain.session.controller;

import com.runway.backend.domain.session.dto.request.CreateRunningSessionRequest;
import com.runway.backend.domain.session.dto.request.SessionControlRequest;
import com.runway.backend.domain.session.dto.request.UpdateRunningSessionRequest;
import com.runway.backend.domain.session.dto.request.UpdateRunningSessionRequestSchema;
import com.runway.backend.domain.session.dto.response.CancelledSessionResponse;
import com.runway.backend.domain.session.dto.response.ControlApprovalResponse;
import com.runway.backend.domain.session.dto.response.ControlResultResponse;
import com.runway.backend.domain.session.dto.response.DeletedSessionResponse;
import com.runway.backend.domain.session.dto.response.PreparedResponse;
import com.runway.backend.domain.session.dto.response.RunningSessionResponse;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.service.RunningSessionControlService;
import com.runway.backend.domain.session.service.RunningSessionService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.validation.constraints.Positive;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 요청 본문은 숫자 자동 변환과 double 반올림을 막기 위해 원문 JSON 문자열로 받아 요청 DTO의 fromJson에서 검증한다. OpenAPI에는 문자열 대신 실제
 * 요청 필드를 문서 스키마로 표시한다.
 */
@RestController
@RequestMapping("/api/v1/running-sessions")
@RequiredArgsConstructor
public class RunningSessionController {

    private final RunningSessionService runningSessionService;
    private final RunningSessionControlService runningSessionControlService;

    @ApiResponse(
            responseCode = "201",
            content = @Content(schema = @Schema(implementation = RunningSessionResponse.class)))
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<RunningSessionResponse> create(
            @AuthenticationPrincipal AuthenticatedUser user,
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            schema =
                                                    @Schema(
                                                            implementation =
                                                                    CreateRunningSessionRequest.class)))
                    @RequestBody
                    String body) {
        Instant receivedAt = Instant.now();
        long userId = CurrentUserIdResolver.requireUserId(user);
        CreateRunningSessionRequest request = CreateRunningSessionRequest.fromJson(body);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(runningSessionService.create(userId, request, receivedAt));
    }

    @GetMapping("/{sessionId}")
    public RunningSessionResponse get(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long sessionId) {
        Instant receivedAt = Instant.now();
        long userId = CurrentUserIdResolver.requireUserId(user);
        return runningSessionService.get(userId, sessionId, receivedAt);
    }

    /** REPORT_PREPARED는 확인한 버전만, 나머지 작업은 변경 후 전체 상태를 반환한다. */
    @ApiResponse(
            responseCode = "200",
            description = "REPORT_PREPARED는 PreparedResponse, 그 밖의 작업은 RunningSessionResponse",
            content =
                    @Content(
                            schema =
                                    @Schema(
                                            oneOf = {
                                                RunningSessionResponse.class,
                                                PreparedResponse.class
                                            })))
    @PatchMapping(value = "/{sessionId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object update(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long sessionId,
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            schema =
                                                    @Schema(
                                                            implementation =
                                                                    UpdateRunningSessionRequestSchema.class)))
                    @RequestBody
                    String body) {
        Instant receivedAt = Instant.now();
        long userId = CurrentUserIdResolver.requireUserId(user);
        UpdateRunningSessionRequest request = UpdateRunningSessionRequest.fromJson(body);
        if (request.operation() == UpdateRunningSessionRequest.Operation.REPORT_PREPARED) {
            return runningSessionService.reportPrepared(userId, sessionId, request);
        }
        return runningSessionService.update(userId, sessionId, request, receivedAt);
    }

    /** S03. REQUEST는 ControlApprovalResponse, RESULT는 ControlResultResponse. */
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            schema =
                                    @Schema(
                                            oneOf = {
                                                ControlApprovalResponse.class,
                                                ControlResultResponse.class
                                            })))
    @PostMapping(value = "/{sessionId}/start", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object start(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long sessionId,
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            schema =
                                                    @Schema(
                                                            implementation =
                                                                    SessionControlRequest.class)))
                    @RequestBody
                    String body) {
        return control(user, sessionId, ControlAction.START, body);
    }

    /** S04. 응답 형식은 S03과 같다. */
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            schema =
                                    @Schema(
                                            oneOf = {
                                                ControlApprovalResponse.class,
                                                ControlResultResponse.class
                                            })))
    @PostMapping(value = "/{sessionId}/pause", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object pause(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long sessionId,
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            schema =
                                                    @Schema(
                                                            implementation =
                                                                    SessionControlRequest.class)))
                    @RequestBody
                    String body) {
        return control(user, sessionId, ControlAction.PAUSE, body);
    }

    /** S05. 응답 형식은 S03과 같다. */
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            schema =
                                    @Schema(
                                            oneOf = {
                                                ControlApprovalResponse.class,
                                                ControlResultResponse.class
                                            })))
    @PostMapping(value = "/{sessionId}/resume", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object resume(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long sessionId,
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            schema =
                                                    @Schema(
                                                            implementation =
                                                                    SessionControlRequest.class)))
                    @RequestBody
                    String body) {
        return control(user, sessionId, ControlAction.RESUME, body);
    }

    /** S06. END의 RESULT/APPLIED는 uploadComplete=true가 있어야 종료를 확정한다. */
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            schema =
                                    @Schema(
                                            oneOf = {
                                                ControlApprovalResponse.class,
                                                ControlResultResponse.class
                                            })))
    @PostMapping(value = "/{sessionId}/finish", consumes = MediaType.APPLICATION_JSON_VALUE)
    public Object finish(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long sessionId,
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            schema =
                                                    @Schema(
                                                            implementation =
                                                                    SessionControlRequest.class)))
                    @RequestBody
                    String body) {
        return control(user, sessionId, ControlAction.END, body);
    }

    /** S07. 본문이 없다. 준비(READY) 세션만 취소한다. */
    @PostMapping("/{sessionId}/cancel")
    public CancelledSessionResponse cancel(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long sessionId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return runningSessionControlService.cancel(userId, sessionId);
    }

    private Object control(
            AuthenticatedUser user, long sessionId, ControlAction action, String body) {
        Instant receivedAt = Instant.now();
        long userId = CurrentUserIdResolver.requireUserId(user);
        SessionControlRequest request = SessionControlRequest.fromJson(body, action);
        return runningSessionControlService.control(userId, sessionId, action, request, receivedAt);
    }

    @DeleteMapping("/{sessionId}")
    public DeletedSessionResponse delete(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long sessionId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return runningSessionService.delete(userId, sessionId);
    }
}
