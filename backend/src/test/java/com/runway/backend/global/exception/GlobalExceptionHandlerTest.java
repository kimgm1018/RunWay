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
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

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
                .andExpect(jsonPath("$.message").value("세션을 찾을 수 없습니다."))
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
    void 없는_detail값은_빼고_상태와_코드를_유지한다() throws Exception {
        mvc.perform(
                        get("/__test/null-detail")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("세션을 찾을 수 없습니다."))
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
            throw new ApiException(
                    HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND", "세션을 찾을 수 없습니다.", Map.of());
        }

        @GetMapping("/__test/boom")
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

        @GetMapping("/__test/null-detail")
        void nullDetail() {
            Map<String, Object> details = new HashMap<>();
            details.put("hint", null);
            details.put("keep", "ok");
            throw new ApiException(
                    HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND", "세션을 찾을 수 없습니다.", details);
        }

        @GetMapping("/__test/null-message")
        void nullMessage() {
            throw new ApiException(HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND", null);
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
