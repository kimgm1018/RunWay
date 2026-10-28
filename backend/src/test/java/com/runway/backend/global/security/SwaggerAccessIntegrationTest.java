package com.runway.backend.global.security;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.securityfixture.SecurityTestApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        classes = SecurityTestApplication.class,
        properties = {
            "runway.security.docs-access-mode=password",
            "runway.security.docs-username=test-docs"
        })
@AutoConfigureMockMvc
class SwaggerAccessIntegrationTest {

    @DynamicPropertySource
    static void password(DynamicPropertyRegistry registry) {
        String hash = "{bcrypt}" + new BCryptPasswordEncoder(4).encode("synthetic-docs-password");
        registry.add("runway.security.docs-password-hash", () -> hash);
    }

    @Autowired MockMvc mvc;

    @Test
    void 공유문서_화면_명세_정적자원에_모두_문서인증이필요하다() throws Exception {
        for (String path :
                new String[] {
                    "/swagger-ui/index.html",
                    "/v3/api-docs",
                    "/v3/api-docs.yaml",
                    "/v3/api-docs/swagger-config",
                    "/swagger-ui/swagger-ui.css",
                    "/swagger-ui/swagger-ui-bundle.js",
                    "/swagger-ui/swagger-ui-standalone-preset.js",
                    "/swagger-ui/swagger-initializer.js"
                }) {
            mvc.perform(get(path))
                    .andExpect(status().isUnauthorized())
                    .andExpect(header().string("WWW-Authenticate", "Basic realm=\"RunWay Docs\""));
            mvc.perform(get(path).with(httpBasic("test-docs", "synthetic-docs-password")))
                    .andExpect(status().isOk());
            mvc.perform(get(path).header("Authorization", SecurityTestSupport.bearer(17)))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(get("/swagger-ui.html")).andExpect(status().isUnauthorized());
        mvc.perform(get("/swagger-ui.html").with(httpBasic("test-docs", "synthetic-docs-password")))
                .andExpect(status().is3xxRedirection());
    }

    @Test
    void 문서계정과_회원JWT는_서로대신할수없다() throws Exception {
        mvc.perform(get("/__test/who").with(httpBasic("test-docs", "synthetic-docs-password")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/__test/who").header("Authorization", SecurityTestSupport.bearer(17)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(17));
        mvc.perform(get("/v3/api-docs").with(httpBasic("test-docs", "wrong")))
                .andExpect(status().isUnauthorized());
        mvc.perform(
                        post("/v3/api-docs")
                                .with(httpBasic("test-docs", "synthetic-docs-password"))
                                .with(csrf()))
                .andExpect(status().isForbidden());
        mvc.perform(
                        get("/v3/api-docs/swagger-config")
                                .with(httpBasic("test-docs", "synthetic-docs-password")))
                .andExpect(jsonPath("$.persistAuthorization").value(false));
    }
}
