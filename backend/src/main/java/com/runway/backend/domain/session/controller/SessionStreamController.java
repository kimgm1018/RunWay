package com.runway.backend.domain.session.controller;

import com.runway.backend.domain.session.service.RunningSessionService;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.exception.ApiErrorResponse;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.exception.RetryableSqlStates;
import com.runway.backend.global.security.AuthenticatedUser;

import jakarta.servlet.http.HttpServletRequest;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.sql.SQLException;
import java.time.Instant;
import java.util.Map;

/**
 * S10 활성 러닝 이벤트 구독. 연결 전에 S02와 같은 회원·소유·삭제 검사를 HTTP 오류로 끝내고, 통과하면 SSE 스트림을 연다. 건강정보 동의로 거절하지 않는다
 * (S15P31E105-257 D-7).
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/running-sessions")
@RequiredArgsConstructor
public class SessionStreamController {

    private static final String BEARER = "Bearer ";

    private final RunningSessionService runningSessionService;
    private final SessionStreamRegistry registry;
    private final JwtDecoder jwtDecoder;

    /**
     * 경로 ID는 문자열로 받아 직접 검사한다. 숫자 변환 실패도 연결 전 VALIDATION_ERROR 본문으로 돌려주기 위해서다. 토큰 만료시각은 소유 검사보다 먼저 읽어,
     * 검사가 늦어지는 동안 만료돼도 만료된 것으로 처리한다.
     */
    @GetMapping("/{sessionId}/events")
    public SseEmitter events(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable("sessionId") String rawSessionId,
            HttpServletRequest request) {
        Instant tokenExpiresAt = tokenExpiresAt(request);
        long userId = CurrentUserIdResolver.requireUserId(user);
        long sessionId = parseSessionId(rawSessionId);
        runningSessionService.get(userId, sessionId, Instant.now());
        return registry.subscribe(userId, sessionId, tokenExpiresAt);
    }

    private static long parseSessionId(String raw) {
        try {
            long value = Long.parseLong(raw);
            if (value > 0) {
                return value;
            }
        } catch (NumberFormatException ignored) {
            // 아래에서 거절한다.
        }
        throw new ApiException(
                ErrorCode.VALIDATION_ERROR,
                Map.of(
                        "fields",
                        java.util.List.of(Map.of("name", "sessionId", "reason", "양의 정수여야 합니다."))));
    }

    /**
     * SSE 클라이언트는 Accept: text/event-stream으로 요청하므로 공통 오류 응답이 내용 협상에서 실패한다. 연결 전 오류는 JSON 형식을 명시해 공통
     * 규약과 같은 본문으로 돌려준다. 데이터 접근 장애의 503/500 구분은 공통 오류 처리와 같다.
     */
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiErrorResponse> handleApiException(ApiException exception) {
        return json(exception.status().value(), ApiErrorResponse.of(exception));
    }

    @ExceptionHandler({
        TransientDataAccessException.class,
        DataAccessResourceFailureException.class,
        CannotCreateTransactionException.class
    })
    ResponseEntity<ApiErrorResponse> handleTransientDataAccess(Exception exception) {
        log.error("S10 연결 전 일시적인 데이터 접근 장애 ({})", exception.getClass().getSimpleName());
        return error(ErrorCode.SERVICE_UNAVAILABLE);
    }

    @ExceptionHandler(UncategorizedSQLException.class)
    ResponseEntity<ApiErrorResponse> handleUncategorizedSql(UncategorizedSQLException exception) {
        SQLException cause = exception.getSQLException();
        boolean retryable = cause != null && RetryableSqlStates.contains(cause.getSQLState());
        log.error("S10 연결 전 SQL 오류 ({})", retryable ? "retryable" : "non-retryable");
        return error(retryable ? ErrorCode.SERVICE_UNAVAILABLE : ErrorCode.INTERNAL_ERROR);
    }

    private static ResponseEntity<ApiErrorResponse> error(ErrorCode code) {
        return json(code.status().value(), ApiErrorResponse.of(code, Map.of()));
    }

    private static ResponseEntity<ApiErrorResponse> json(int status, ApiErrorResponse body) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body);
    }

    /**
     * 인증 필터가 이미 검증한 같은 토큰에서 만료시각만 읽는다. 그 사이 만료돼 다시 읽지 못하면 지금 만료된 것으로 본다. 토큰 값은 저장·기록하지 않는다.
     */
    private Instant tokenExpiresAt(HttpServletRequest request) {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith(BEARER)) {
            return null;
        }
        try {
            return jwtDecoder.decode(header.substring(BEARER.length())).getExpiresAt();
        } catch (JwtException e) {
            return Instant.now();
        }
    }
}
