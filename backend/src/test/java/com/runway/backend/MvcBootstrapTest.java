package com.runway.backend;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityConfig;
import com.runway.backend.global.security.SecurityTestSupport;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@WebMvcTest(MvcBootstrapTest.FixtureController.class)
@Import({MvcBootstrapTest.FixtureController.class, SecurityConfig.class})
class MvcBootstrapTest {

    @Autowired private MockMvc mvc;

    @Test
    void 유효요청_JSON응답_값을보존한다() throws Exception {
        mvc.perform(
                        post("/__test/echo")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"value\":\"sample\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.value").value("sample"));
    }

    @Test
    void 빈필수문자열_요청_400을반환한다() throws Exception {
        mvc.perform(
                        post("/__test/echo")
                                .header("Authorization", SecurityTestSupport.bearer(1))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"value\":\"\"}"))
                .andExpect(status().isBadRequest());
    }

    record FixtureRequest(@NotBlank String value) {}

    record FixtureResponse(String value) {}

    @RestController
    static class FixtureController {
        @PostMapping("/__test/echo")
        FixtureResponse echo(@Valid @RequestBody FixtureRequest request) {
            return new FixtureResponse(request.value());
        }
    }
}
