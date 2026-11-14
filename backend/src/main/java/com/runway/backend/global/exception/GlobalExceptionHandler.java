package com.runway.backend.global.exception;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingPathVariableException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

@RestControllerAdvice
public class GlobalExceptionHandler {

    static final String TYPE_MISMATCH_REASON = "형식이 올바르지 않습니다.";
    static final String REQUIRED_REASON = "필수 값입니다.";

    private static final Pattern API_ROUTE_PATTERN = Pattern.compile("/api/v1/[A-Za-z0-9_/{}.-]{1,160}");

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 문자열 값을 DB가 받을 수 없을 때의 SQLState(S15P31E105-803, {@link #unstorableTextSqlState}). */
    private static final Set<String> UNSTORABLE_TEXT_SQL_STATES = Set.of("22021", "22P05");

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiErrorResponse> handleApiException(
            ApiException exception, HttpServletRequest request) {
        if (exception.status().is5xxServerError()) {
            log.error("runway_route={} runway_error={}", safeRoute(request), exception.code());
        }
        return ResponseEntity.status(exception.status()).body(ApiErrorResponse.of(exception));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, BindException.class})
    ResponseEntity<ApiErrorResponse> handleBinding(BindException exception) {
        List<Map<String, String>> fields = new ArrayList<>();
        for (FieldError error : exception.getFieldErrors()) {
            fields.add(field(error.getField(), fieldReason(error)));
        }
        exception
                .getGlobalErrors()
                .forEach(
                        error ->
                                fields.add(
                                        field(error.getObjectName(), error.getDefaultMessage())));
        return validation(fields);
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<ApiErrorResponse> handleMethodValidation(
            HandlerMethodValidationException exception) {
        List<Map<String, String>> fields = new ArrayList<>();
        exception
                .getParameterValidationResults()
                .forEach(
                        result -> {
                            String name = result.getMethodParameter().getParameterName();
                            result.getResolvableErrors()
                                    .forEach(
                                            error ->
                                                    fields.add(
                                                            field(
                                                                    name,
                                                                    error.getDefaultMessage())));
                        });
        return validation(fields);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ApiErrorResponse> handleConstraintViolation(
            ConstraintViolationException exception) {
        List<Map<String, String>> fields = new ArrayList<>();
        for (ConstraintViolation<?> violation : exception.getConstraintViolations()) {
            fields.add(field(violation.getPropertyPath().toString(), violation.getMessage()));
        }
        return validation(fields);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiErrorResponse> handleUnreadable(HttpMessageNotReadableException exception) {
        return validation(List.of());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiErrorResponse> handleTypeMismatch(
            MethodArgumentTypeMismatchException exception) {
        return validation(List.of(field(exception.getName(), TYPE_MISMATCH_REASON)));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    ResponseEntity<ApiErrorResponse> handleMissingParameter(
            MissingServletRequestParameterException exception) {
        return validation(List.of(field(exception.getParameterName(), REQUIRED_REASON)));
    }

    @ExceptionHandler(MissingPathVariableException.class)
    ResponseEntity<ApiErrorResponse> handleMissingPath(MissingPathVariableException exception) {
        return validation(List.of(field(exception.getVariableName(), REQUIRED_REASON)));
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    ResponseEntity<ApiErrorResponse> handleMissingPart(
            MissingServletRequestPartException exception) {
        return validation(List.of(field(exception.getRequestPartName(), REQUIRED_REASON)));
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    ResponseEntity<ApiErrorResponse> handleMissingHeader(MissingRequestHeaderException exception) {
        return validation(List.of(field(exception.getHeaderName(), REQUIRED_REASON)));
    }

    @ExceptionHandler(ServletRequestBindingException.class)
    ResponseEntity<ApiErrorResponse> handleRequestBinding(
            ServletRequestBindingException exception) {
        return validation(List.of());
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ApiErrorResponse> handleFileTooLarge(MaxUploadSizeExceededException exception) {
        return response(ErrorCode.FILE_TOO_LARGE, Map.of());
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiErrorResponse> handleUnsupportedMedia(
            HttpMediaTypeNotSupportedException exception) {
        return response(ErrorCode.UNSUPPORTED_MEDIA_TYPE, Map.of());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiErrorResponse> handleNoResource(NoResourceFoundException exception) {
        return response(ErrorCode.NOT_FOUND, Map.of());
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiErrorResponse> handleMethodNotAllowed(
            HttpRequestMethodNotSupportedException exception) {
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED);
        Set<HttpMethod> allowed = exception.getSupportedHttpMethods();
        if (allowed != null && !allowed.isEmpty()) {
            builder.allow(allowed.toArray(HttpMethod[]::new));
        }
        return builder.body(ApiErrorResponse.of(ErrorCode.METHOD_NOT_ALLOWED, Map.of()));
    }

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    ResponseEntity<Void> handleNotAcceptable(HttpMediaTypeNotAcceptableException exception) {
        return ResponseEntity.status(HttpStatus.NOT_ACCEPTABLE).build();
    }

    @ExceptionHandler(AsyncRequestTimeoutException.class)
    ResponseEntity<ApiErrorResponse> handleTimeout(
            AsyncRequestTimeoutException exception, HttpServletRequest request) {
        logServerError(request, ErrorCode.SERVICE_UNAVAILABLE.code(), "일시적으로 처리하지 못한 요청", exception);
        return response(ErrorCode.SERVICE_UNAVAILABLE, Map.of());
    }

    /**
     * 잠금 대기 초과·교착 상태·쿼리 시간초과·연결 실패처럼 다시 시도하면 성공할 수 있는 데이터 접근 장애는 503이다. 제약 위반 등 재시도해도 결과가 같은 데이터
     * 오류는 500으로 남긴다(api/README.md 공통 오류 응답). 503도 저장 미완료를 보장하지 않으며 클라이언트가 결과를 확인한 뒤 재시도한다.
     */
    @ExceptionHandler({
        TransientDataAccessException.class,
        DataAccessResourceFailureException.class,
        CannotCreateTransactionException.class
    })
    ResponseEntity<ApiErrorResponse> handleTransientDataAccess(
            Exception exception, HttpServletRequest request) {
        logServerError(request, ErrorCode.SERVICE_UNAVAILABLE.code(), "일시적인 데이터 접근 장애", exception);
        return response(ErrorCode.SERVICE_UNAVAILABLE, Map.of());
    }

    /**
     * JdbcTemplate은 기본 설정에서 PostgreSQL의 잠금 대기 초과(55P03)를 분류하지 못하고 UncategorizedSQLException으로 남긴다.
     * JPA 경로는 같은 장애를 일시적 장애로 바꾸므로, 저장소 기술과 무관하게 같은 503이 되도록 SQLState로 판별한다(S15P31E105-253, 공통 대기 상한
     * S15P31E105-294). 판별 목록은 {@link RetryableSqlStates}를 따른다. 그 밖의 분류되지 않은 SQL 오류는 500을 유지한다.
     */
    @ExceptionHandler(UncategorizedSQLException.class)
    ResponseEntity<ApiErrorResponse> handleUncategorizedSql(
            UncategorizedSQLException exception, HttpServletRequest request) {
        SQLException cause = exception.getSQLException();
        if (cause != null && RetryableSqlStates.contains(cause.getSQLState())) {
            return handleTransientDataAccess(exception, request);
        }
        return handleUnexpected(exception, request);
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ApiErrorResponse> handleResponseStatus(
            ResponseStatusException exception, HttpServletRequest request) {
        HttpStatusCode status = exception.getStatusCode();
        ResponseEntity<ApiErrorResponse> known = knownStatus(status);
        if (status.is5xxServerError()) {
            ApiErrorResponse body = known == null ? null : known.getBody();
            String code = body == null ? "UNKNOWN" : body.code();
            logServerError(request, code, "처리하지 못한 예외", exception);
        }
        if (known != null) {
            return known;
        }
        return ResponseEntity.status(status).build();
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiErrorResponse> handleUnexpected(
            Exception exception, HttpServletRequest request) {
        ErrorCode guard = withdrawalGuard(exception);
        if (guard != null) return response(guard, Map.of());
        String unstorable = unstorableTextSqlState(exception);
        if (unstorable != null) {
            // 원인을 찾을 수 있게 경로·메서드·SQLState만 남긴다. 입력 원문·파라미터·SQL·스택은 남기지 않는다(S15P31E105-803 리뷰 A-1·B-1).
            log.warn(
                    "runway_route={} runway_method={} runway_error={} unstorable_text sqlstate={}",
                    safeRoute(request),
                    request.getMethod(),
                    ErrorCode.VALIDATION_ERROR.code(),
                    unstorable);
            return validation(List.of());
        }
        logServerError(request, ErrorCode.INTERNAL_ERROR.code(), "처리하지 못한 예외", exception);
        return response(ErrorCode.INTERNAL_ERROR, Map.of());
    }

    private static void logServerError(
            HttpServletRequest request, String code, String message, Exception exception) {
        log.error(
                "runway_route={} runway_error={} {}",
                safeRoute(request),
                code,
                message,
                exception);
    }

    private static String safeRoute(HttpServletRequest request) {
        Object matchedPattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        String route = matchedPattern == null ? "unknown" : matchedPattern.toString();
        return API_ROUTE_PATTERN.matcher(route).matches() ? route : "unknown";
    }

    /**
     * PostgreSQL이 문자열 값을 저장·비교할 수 없어 거절한 경우(S15P31E105-803). 입력 문자열의 NUL(U+0000)이 대표적이며
     * 22021(invalid byte sequence for encoding)·22P05(untranslatable character)만 해당한다. 같은 입력은 다시 보내도 같은
     * 결과라 400 VALIDATION_ERROR로 응답한다. 그 밖의 22xxx(길이 초과 22001 등)와 제약 위반은 지금처럼 500이다.
     * 해당하면 그 SQLState, 아니면 null을 돌려준다.
     */
    private static String unstorableTextSqlState(Throwable exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException first) {
                for (SQLException sql = first; sql != null; sql = sql.getNextException()) {
                    if (UNSTORABLE_TEXT_SQL_STATES.contains(sql.getSQLState())) return sql.getSQLState();
                }
            }
        }
        return null;
    }

    private static ErrorCode withdrawalGuard(Throwable exception) {
        for (Throwable cause=exception; cause!=null; cause=cause.getCause()) {
            if (cause instanceof SQLException first) {
                for (SQLException sql=first; sql!=null; sql=sql.getNextException()) {
                    if (!"23514".equals(sql.getSQLState())) continue;
                    try {
                        Object message=sql.getClass().getMethod("getServerErrorMessage").invoke(sql);
                        String constraint=(String) message.getClass().getMethod("getConstraint").invoke(message);
                        if ("rw_active_owner".equals(constraint)) return ErrorCode.UNAUTHORIZED;
                        if ("rw_active_post".equals(constraint)) return ErrorCode.POST_NOT_FOUND;
                    } catch (ReflectiveOperationException | NullPointerException ignored) {
                        // Preserve the original handling for unrelated database failures.
                    }
                }
            }
        }
        return null;
    }

    private static ResponseEntity<ApiErrorResponse> validation(List<Map<String, String>> fields) {
        Map<String, Object> details =
                fields.isEmpty() ? Map.of() : Map.of("fields", List.copyOf(fields));
        return response(ErrorCode.VALIDATION_ERROR, details);
    }

    private static String fieldReason(FieldError error) {
        String[] codes = error.getCodes();
        if (codes != null) {
            for (String code : codes) {
                if (code != null
                        && (code.equals("typeMismatch") || code.startsWith("typeMismatch."))) {
                    return TYPE_MISMATCH_REASON;
                }
            }
        }
        return error.getDefaultMessage();
    }

    private static ResponseEntity<ApiErrorResponse> knownStatus(HttpStatusCode status) {
        if (status.isSameCodeAs(HttpStatus.BAD_REQUEST)) {
            return response(ErrorCode.VALIDATION_ERROR, Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.NOT_FOUND)) {
            return response(ErrorCode.NOT_FOUND, Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.METHOD_NOT_ALLOWED)) {
            return response(ErrorCode.METHOD_NOT_ALLOWED, Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.CONTENT_TOO_LARGE)) {
            return response(ErrorCode.FILE_TOO_LARGE, Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.UNSUPPORTED_MEDIA_TYPE)) {
            return response(ErrorCode.UNSUPPORTED_MEDIA_TYPE, Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.INTERNAL_SERVER_ERROR)) {
            return response(ErrorCode.INTERNAL_ERROR, Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.SERVICE_UNAVAILABLE)) {
            return response(ErrorCode.SERVICE_UNAVAILABLE, Map.of());
        }
        return null;
    }

    private static Map<String, String> field(String name, String reason) {
        return Map.of(
                "name", name == null ? "" : name, "reason", reason == null ? "유효하지 않습니다." : reason);
    }

    private static ResponseEntity<ApiErrorResponse> response(
            ErrorCode errorCode, Map<String, Object> details) {
        return ResponseEntity.status(errorCode.status())
                .body(ApiErrorResponse.of(errorCode, details));
    }
}
