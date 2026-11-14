package com.runway.backend.global.exception;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityConfig;
import com.runway.backend.global.security.SecurityTestSupport;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.Map;

@ExtendWith(OutputCaptureExtension.class)
@WebMvcTest(GlobalExceptionHandlerTest.FixtureController.class)
@Import({
    GlobalExceptionHandlerTest.FixtureController.class,
    GlobalExceptionHandler.class,
    SecurityConfig.class,
    SecurityTestSupport.AuthenticatedRequests.class
})
class GlobalExceptionHandlerTest {

    @Autowired private MockMvc mvc;

    @Test
    void 서버오류로그는_경로패턴과_오류코드를_남긴다(CapturedOutput output) throws Exception {
        mvc.perform(get("/api/v1/__test/courses/987654321")
                        .header("Authorization", SecurityTestSupport.bearer(1))
                        .param("token", "private-query-value"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));

        mvc.perform(get("/__test/boom").header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));

        org.assertj.core.api.Assertions.assertThat(output.getAll())
                .contains("runway_route=/api/v1/__test/courses/{courseId} runway_error=INTERNAL_ERROR")
                .contains("runway_route=unknown runway_error=INTERNAL_ERROR")
                .doesNotContain("987654321", "private-query-value");
    }

    @Test
    void 빈필수문자열은_필드오류로_400을반환한다() throws Exception {
        mvc.perform(
                        post("/__test/echo")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"value\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.message").value("요청 값이 유효하지 않습니다."))
                .andExpect(jsonPath("$.details.fields[0].name").value("value"))
                .andExpect(jsonPath("$.details.fields[0].reason").value("비어 있을 수 없습니다."))
                .andExpect(jsonPath("$.details.fields[0].value").doesNotExist());
    }

    @Test
    void 잘못된_JSON은_입력값없이_400을반환한다() throws Exception {
        mvc.perform(
                        post("/__test/echo")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields").doesNotExist())
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString(
                                                        "JsonParse"))));
    }

    @Test
    void 쿼리타입불일치는_값없이_400을반환한다() throws Exception {
        mvc.perform(
                        get("/__test/numbers")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .param("count", "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields[0].name").value("count"))
                .andExpect(jsonPath("$.details.fields[0].reason").value("형식이 올바르지 않습니다."))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString("abc"))));
    }

    @Test
    void 필수쿼리누락은_400을반환한다() throws Exception {
        mvc.perform(get("/__test/need").header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields[0].name").value("name"))
                .andExpect(jsonPath("$.details.fields[0].reason").value("필수 값입니다."));
    }

    @Test
    void 공통예외_상태와_코드를_반환한다() throws Exception {
        mvc.perform(get("/__test/missing").header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("러닝 세션을 찾을 수 없습니다."))
                .andExpect(jsonPath("$.details").isMap());
    }

    @Test
    void 예상하지_못한_예외는_고정_500이다() throws Exception {
        mvc.perform(get("/__test/boom").header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.message").value("서버 오류가 발생했습니다."))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString("SELECT"))))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString(
                                                        "Exception"))));
    }

    @Test
    void 지원하지_않는_콘텐츠형식은_415를반환한다() throws Exception {
        mvc.perform(
                        post("/__test/echo")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .contentType(MediaType.TEXT_PLAIN)
                                .content("text"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    @Test
    void 업로드크기초과는_413을반환한다() throws Exception {
        mvc.perform(post("/__test/files").header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().is(413))
                .andExpect(jsonPath("$.code").value("FILE_TOO_LARGE"))
                .andExpect(jsonPath("$.message").value("업로드 크기를 초과했습니다."));
    }

    @Test
    void 없는경로는_500이_아니다() throws Exception {
        mvc.perform(get("/__test/absent").header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void 허용되지_않는_메서드는_405다() throws Exception {
        mvc.perform(
                        post("/__test/numbers")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"))
                .andExpect(jsonPath("$.message").value("허용되지 않는 메서드입니다."))
                .andExpect(
                        header().string(
                                        HttpHeaders.ALLOW,
                                        org.hamcrest.Matchers.containsString("GET")))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString(
                                                        "INTERNAL_ERROR"))));
    }

    @Test
    void 빠진파트는_400이다() throws Exception {
        mvc.perform(multipart("/__test/part"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields[0].name").value("file"))
                .andExpect(jsonPath("$.details.fields[0].reason").value("필수 값입니다."));
    }

    @Test
    void 빠진헤더는_400이다() throws Exception {
        mvc.perform(get("/__test/header").header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields[0].name").value("X-Request-Id"))
                .andExpect(jsonPath("$.details.fields[0].reason").value("필수 값입니다."));
    }

    @Test
    void 폼타입불일치에는_거절값이_없다() throws Exception {
        mvc.perform(
                        post("/__test/form")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                                .content("count=REJECTEDTOKEN"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.details.fields[0].name").value("count"))
                .andExpect(jsonPath("$.details.fields[0].reason").value("형식이 올바르지 않습니다."))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString(
                                                        "REJECTEDTOKEN"))));
    }

    @Test
    void 상태예외는_선언한_상태를_유지하고_사유를_숨긴다() throws Exception {
        mvc.perform(get("/__test/status").header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString(
                                                        "REJECTEDTOKEN"))));
    }

    @Test
    void 이미_503인_예외는_500이_아니다() throws Exception {
        mvc.perform(
                        get("/__test/unavailable")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.message").value("일시적으로 처리할 수 없습니다."))
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString("database"))));
    }

    @Test
    void 일시적인_데이터접근_장애는_503이고_원인을_숨긴다() throws Exception {
        for (String kind :
                new String[] {
                    "lock",
                    "timeout",
                    "connection",
                    "transaction",
                    "jdbc-lock-timeout",
                    "jdbc-statement-timeout",
                    "jdbc-serialization",
                    "jdbc-deadlock"
                }) {
            mvc.perform(
                            get("/__test/data-access")
                                    .param("kind", kind)
                                    .header("Authorization", SecurityTestSupport.bearer(1)))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"))
                    .andExpect(jsonPath("$.message").value("일시적으로 처리할 수 없습니다."))
                    .andExpect(
                            content()
                                    .string(
                                            org.hamcrest.Matchers.not(
                                                    org.hamcrest.Matchers.containsString(
                                                            "running_sessions"))));
        }
    }

    /** JdbcTemplate이 분류하지 못한 SQL 오류 중 재시도 대상이 아닌 SQLState는 500이다. */
    @Test
    void 분류되지_않은_일반_SQL_오류는_500이다() throws Exception {
        mvc.perform(
                        get("/__test/data-access")
                                .param("kind", "jdbc-other")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
    }

    @Test
    void 제약위반은_재시도_대상이_아니므로_500이다() throws Exception {
        mvc.perform(
                        get("/__test/data-access")
                                .param("kind", "integrity")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
    }

    // S15P31E105-803: 문자열에 NUL처럼 DB가 받을 수 없는 문자가 있어 생긴 22021·22P05는 입력 오류라 400이고 원인을 숨긴다.
    @Test
    void 저장할수없는_문자열은_400_VALIDATION_ERROR다() throws Exception {
        for (String kind : new String[] {"text-nul", "text-untranslatable", "jdbc-text-nul"}) {
            mvc.perform(
                            get("/__test/data-access")
                                    .param("kind", kind)
                                    .header("Authorization", SecurityTestSupport.bearer(1)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(
                            content()
                                    .string(
                                            org.hamcrest.Matchers.not(
                                                    org.hamcrest.Matchers.containsString(
                                                            "region_code"))));
        }
    }

    // S15P31E105-803 리뷰 A-1·B-1: 400으로 바꿀 때 경로·메서드·SQLState만 warn으로 남기고, 쿼리 값·DB 메시지·SQL은 남기지 않는다.
    @Test
    void 저장할수없는_문자열은_경로와_SQLState만_로그에_남긴다(CapturedOutput output) throws Exception {
        // 실제 API 경로 패턴: 처리기가 경로 값·쿼리 값을 받는 컨트롤러에서 JdbcTemplate 모양(UncategorizedSQLException) 22021.
        mvc.perform(
                        get("/api/v1/__test/regions/{regionCode}", "private-path-value")
                                .param("q", "private-query-value")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        // 패턴 밖 경로: JPA 모양(DataIntegrityViolationException) 22P05.
        mvc.perform(
                        get("/__test/data-access")
                                .param("kind", "text-untranslatable")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isBadRequest());

        org.assertj.core.api.Assertions.assertThat(output.getAll())
                .contains(
                        "runway_route=/api/v1/__test/regions/{regionCode} runway_method=GET"
                                + " runway_error=VALIDATION_ERROR unstorable_text sqlstate=22021")
                .contains(
                        "runway_route=unknown runway_method=GET runway_error=VALIDATION_ERROR"
                                + " unstorable_text sqlstate=22P05")
                .doesNotContain(
                        "private-path-value",
                        "private-query-value",
                        "invalid value in posts.region_code",
                        "lock on running_sessions",
                        "running_sessions WHERE id");
    }

    // S15P31E105-820: Tomcat이 쿼리 문자열·POST 폼 파라미터를 해석하지 못한 경우(InvalidParameterException)는 400이고 값·메시지·스택을 숨긴다.
    // 본문 크기 초과(errorCode 413)도 이번에는 413이 아니라 같은 400이며, 로그에는 정수 errorCode만 남긴다.
    @Test
    void 파라미터를_해석하지_못하면_400이고_값을_응답과_로그에_남기지_않는다(CapturedOutput output) throws Exception {
        for (String code : new String[] {"400", "413"}) {
            mvc.perform(
                            get("/api/v1/__test/invalid-parameter")
                                    .param("code", code)
                                    .header("Authorization", SecurityTestSupport.bearer(1)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.details").isEmpty())
                    .andExpect(
                            content()
                                    .string(
                                            org.hamcrest.Matchers.not(
                                                    org.hamcrest.Matchers.containsString(
                                                            "private-bad-value"))));
        }

        org.assertj.core.api.Assertions.assertThat(output.getAll())
                .contains(
                        "runway_route=/api/v1/__test/invalid-parameter runway_method=GET"
                                + " runway_error=VALIDATION_ERROR invalid_parameter errorcode=400",
                        "runway_route=/api/v1/__test/invalid-parameter runway_method=GET"
                                + " runway_error=VALIDATION_ERROR invalid_parameter errorcode=413")
                .doesNotContain("private-bad-value", "Character decoding failed", " ERROR ");
    }

    // S15P31E105-803 회귀: 같은 22 계열이어도 22021·22P05가 아닌 데이터 오류(길이 초과 22001)는 지금처럼 500이다.
    @Test
    void 다른_데이터_오류는_500을_유지한다() throws Exception {
        mvc.perform(
                        get("/__test/data-access")
                                .param("kind", "text-too-long")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
    }

    @Test
    void 없는_detail값은_빼고_상태와_코드를_유지한다() throws Exception {
        mvc.perform(
                        get("/__test/null-detail")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("러닝 세션을 찾을 수 없습니다."))
                .andExpect(jsonPath("$.details.keep").value("ok"))
                .andExpect(jsonPath("$.details.hint").doesNotExist());
    }

    @Test
    void 메시지가_없으면_고정문구를_넣는다() throws Exception {
        mvc.perform(
                        get("/__test/null-message")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("요청을 처리할 수 없습니다."));
    }

    @Test
    void 수락할_수_없는_형식은_500이_아니다() throws Exception {
        mvc.perform(
                        get("/__test/echo-get")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .accept(MediaType.TEXT_PLAIN))
                .andExpect(status().isNotAcceptable())
                .andExpect(
                        content()
                                .string(
                                        org.hamcrest.Matchers.not(
                                                org.hamcrest.Matchers.containsString(
                                                        "INTERNAL_ERROR"))));
    }

    record EchoRequest(@NotBlank(message = "비어 있을 수 없습니다.") String value) {}

    record EchoResponse(String value) {}

    @RestController
    static class FixtureController {
        @PostMapping("/__test/echo")
        EchoResponse echo(@Valid @RequestBody EchoRequest request) {
            return new EchoResponse(request.value());
        }

        @GetMapping("/__test/numbers")
        void number(@RequestParam int count) {}

        @GetMapping("/__test/need")
        void need(@RequestParam String name) {}

        @GetMapping("/__test/missing")
        void missing() {
            throw new ApiException(ErrorCode.SESSION_NOT_FOUND, Map.of());
        }

        @GetMapping({"/__test/boom", "/api/v1/__test/courses/{courseId}"})
        void boom() {
            throw new IllegalStateException("SELECT secret FROM users");
        }

        @PostMapping("/__test/files")
        void upload() {
            throw new MaxUploadSizeExceededException(1);
        }

        @GetMapping("/__test/echo-get")
        EchoResponse echoGet() {
            return new EchoResponse("ok");
        }

        @PostMapping("/__test/part")
        void part(@RequestPart("file") MultipartFile file) {}

        @GetMapping("/__test/header")
        void header(@RequestHeader("X-Request-Id") String id) {}

        @PostMapping("/__test/form")
        void form(@ModelAttribute CountForm form) {}

        @GetMapping("/__test/status")
        void status() {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "REJECTEDTOKEN");
        }

        @GetMapping("/__test/unavailable")
        void unavailable() {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "database down");
        }

        /**
         * JdbcTemplate이 PostgreSQL 오류를 분류하지 못했을 때와 같은 예외. 현재 기본 변환기에서 실제로 이렇게 남는 것은 55P03이며, 나머지
         * SQLState는 변환기 설정이 바뀌어도 503을 유지하는지 보는 방어 사례다.
         */
        private static UncategorizedSQLException uncategorized(String sqlState) {
            return new UncategorizedSQLException(
                    "PreparedStatementCallback",
                    "SELECT id FROM running_sessions WHERE id = ? FOR UPDATE",
                    new java.sql.SQLException("lock on running_sessions", sqlState));
        }

        private static DataIntegrityViolationException dataError(String sqlState) {
            return new DataIntegrityViolationException(
                    "could not execute statement",
                    new java.sql.SQLException("invalid value in posts.region_code", sqlState));
        }

        /** 리뷰 반영(S15P31E105-803): 경로·쿼리 값을 받고 그 값이 든 것처럼 22021을 던진다. 로그에 값이 남지 않는지 본다. */
        @GetMapping("/api/v1/__test/regions/{regionCode}")
        void unstorableRegion(@PathVariable String regionCode, @RequestParam String q) {
            throw new UncategorizedSQLException(
                    "PreparedStatementCallback",
                    "SELECT 1 FROM regions WHERE region_code = '" + regionCode + "' AND name = '" + q + "'",
                    new java.sql.SQLException("invalid byte sequence near " + regionCode + q, "22021"));
        }

        /** S15P31E105-820: Tomcat이 파라미터를 읽을 때 던지는 예외. 메시지에 입력값이 들어 있고 code는 Tomcat의 errorCode다. */
        @GetMapping("/api/v1/__test/invalid-parameter")
        void invalidParameter(@RequestParam(defaultValue = "400") int code) {
            throw new org.apache.tomcat.util.http.InvalidParameterException(
                    "Character decoding failed. Parameter [q] with value [private-bad-value] has been ignored.",
                    code);
        }

        @GetMapping("/__test/data-access")
        void dataAccess(@RequestParam String kind) {
            String detail = "lock on running_sessions";
            throw switch (kind) {
                case "lock" -> new CannotAcquireLockException(detail);
                case "timeout" -> new QueryTimeoutException(detail);
                case "connection" -> new DataAccessResourceFailureException(detail);
                case "transaction" -> new CannotCreateTransactionException(detail);
                case "jdbc-lock-timeout" -> uncategorized("55P03");
                case "jdbc-statement-timeout" -> uncategorized("57014");
                case "jdbc-serialization" -> uncategorized("40001");
                case "jdbc-deadlock" -> uncategorized("40P01");
                case "jdbc-other" -> uncategorized("P0001");
                // S15P31E105-803: Spring이 SQLState 22xxx를 바꾸는 예외 모양(원인에 PostgreSQL SQLException).
                case "text-nul" -> dataError("22021");
                case "text-untranslatable" -> dataError("22P05");
                case "text-too-long" -> dataError("22001");
                // 리뷰 B-3: JdbcTemplate이 분류하지 못해 UncategorizedSQLException으로 남은 22021도 같은 400이다.
                case "jdbc-text-nul" -> uncategorized("22021");
                default -> new DataIntegrityViolationException(detail);
            };
        }

        @GetMapping("/__test/null-detail")
        void nullDetail() {
            Map<String, Object> details = new HashMap<>();
            details.put("hint", null);
            details.put("keep", "ok");
            throw new ApiException(ErrorCode.SESSION_NOT_FOUND, details);
        }

        @GetMapping("/__test/null-message")
        org.springframework.http.ResponseEntity<ApiErrorResponse> nullMessage() {
            return org.springframework.http.ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiErrorResponse(ErrorCode.SESSION_NOT_FOUND.code(), null, Map.of()));
        }
    }

    static class CountForm {
        private int count;

        public int getCount() {
            return count;
        }

        public void setCount(int count) {
            this.count = count;
        }
    }
}
