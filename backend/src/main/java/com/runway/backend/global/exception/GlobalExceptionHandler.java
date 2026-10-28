package com.runway.backend.global.exception;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
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
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    static final String VALIDATION_ERROR = "VALIDATION_ERROR";
    static final String VALIDATION_MESSAGE = "요청 값이 유효하지 않습니다.";
    static final String INTERNAL_ERROR = "INTERNAL_ERROR";
    static final String INTERNAL_MESSAGE = "서버 오류가 발생했습니다.";
    static final String TYPE_MISMATCH_REASON = "형식이 올바르지 않습니다.";
    static final String REQUIRED_REASON = "필수 값입니다.";

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiErrorResponse> handleApiException(ApiException exception) {
        return response(
                exception.status(), exception.code(), exception.getMessage(), exception.details());
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
        return response(
                HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "업로드 크기를 초과했습니다.", Map.of());
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ApiErrorResponse> handleUnsupportedMedia(
            HttpMediaTypeNotSupportedException exception) {
        return response(
                HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                "UNSUPPORTED_MEDIA_TYPE",
                "지원하지 않는 콘텐츠 형식입니다.",
                Map.of());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiErrorResponse> handleNoResource(NoResourceFoundException exception) {
        return response(HttpStatus.NOT_FOUND, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.", Map.of());
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiErrorResponse> handleMethodNotAllowed(
            HttpRequestMethodNotSupportedException exception) {
        ResponseEntity.BodyBuilder builder = ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED);
        Set<HttpMethod> allowed = exception.getSupportedHttpMethods();
        if (allowed != null && !allowed.isEmpty()) {
            builder.allow(allowed.toArray(HttpMethod[]::new));
        }
        return builder.body(ApiErrorResponse.of("METHOD_NOT_ALLOWED", "허용되지 않는 메서드입니다.", Map.of()));
    }

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    ResponseEntity<Void> handleNotAcceptable(HttpMediaTypeNotAcceptableException exception) {
        return ResponseEntity.status(HttpStatus.NOT_ACCEPTABLE).build();
    }

    @ExceptionHandler(AsyncRequestTimeoutException.class)
    ResponseEntity<ApiErrorResponse> handleTimeout(AsyncRequestTimeoutException exception) {
        log.error("일시적으로 처리하지 못한 요청", exception);
        return response(
                HttpStatus.SERVICE_UNAVAILABLE,
                "SERVICE_UNAVAILABLE",
                "일시적으로 처리할 수 없습니다.",
                Map.of());
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ApiErrorResponse> handleResponseStatus(ResponseStatusException exception) {
        HttpStatusCode status = exception.getStatusCode();
        if (status.is5xxServerError()) {
            log.error("처리하지 못한 예외", exception);
        }
        ResponseEntity<ApiErrorResponse> known = knownStatus(status);
        if (known != null) {
            return known;
        }
        return ResponseEntity.status(status).build();
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiErrorResponse> handleUnexpected(Exception exception) {
        log.error("처리하지 못한 예외", exception);
        return response(
                HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL_ERROR, INTERNAL_MESSAGE, Map.of());
    }

    private static ResponseEntity<ApiErrorResponse> validation(List<Map<String, String>> fields) {
        Map<String, Object> details =
                fields.isEmpty() ? Map.of() : Map.of("fields", List.copyOf(fields));
        return response(HttpStatus.BAD_REQUEST, VALIDATION_ERROR, VALIDATION_MESSAGE, details);
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
            return response(status, VALIDATION_ERROR, VALIDATION_MESSAGE, Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.NOT_FOUND)) {
            return response(status, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.", Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.METHOD_NOT_ALLOWED)) {
            return response(status, "METHOD_NOT_ALLOWED", "허용되지 않는 메서드입니다.", Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.CONTENT_TOO_LARGE)) {
            return response(status, "FILE_TOO_LARGE", "업로드 크기를 초과했습니다.", Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.UNSUPPORTED_MEDIA_TYPE)) {
            return response(status, "UNSUPPORTED_MEDIA_TYPE", "지원하지 않는 콘텐츠 형식입니다.", Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.INTERNAL_SERVER_ERROR)) {
            return response(status, INTERNAL_ERROR, INTERNAL_MESSAGE, Map.of());
        }
        if (status.isSameCodeAs(HttpStatus.SERVICE_UNAVAILABLE)) {
            return response(status, "SERVICE_UNAVAILABLE", "일시적으로 처리할 수 없습니다.", Map.of());
        }
        return null;
    }

    private static Map<String, String> field(String name, String reason) {
        return Map.of(
                "name", name == null ? "" : name, "reason", reason == null ? "유효하지 않습니다." : reason);
    }

    private static ResponseEntity<ApiErrorResponse> response(
            org.springframework.http.HttpStatusCode status,
            String code,
            String message,
            Map<String, Object> details) {
        return ResponseEntity.status(status).body(ApiErrorResponse.of(code, message, details));
    }
}
