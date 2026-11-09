package com.runway.backend.global.security;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.securityfixture.SecurityTestApplication;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(classes = SecurityTestApplication.class)
@AutoConfigureMockMvc
class SecurityAccessIntegrationTest {

    @Autowired MockMvc mvc;

    @Test
    void 공개_정확한경로는_잘못된토큰과_무관하게_도달한다() throws Exception {
        for (String path :
                new String[] {
                    "/api/v1/auth/login",
                    "/api/v1/auth/signup",
                    "/api/v1/auth/refresh",
                    "/api/v1/auth/logout",
                    "/api/v1/auth/phone-verifications",
                    "/api/v1/auth/phone-verifications/confirm",
                    "/api/v1/auth/password-reset"
                }) {
            mvc.perform(post(path))
                    .andExpect(status().isOk())
                    .andExpect(content().string("public-handler"));
            mvc.perform(post(path).header("Authorization", "Bearer expired-or-invalid"))
                    .andExpect(status().isOk());
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        }
        mvc.perform(
                        get("/api/v1/auth/login-id/availability")
                                .header("Authorization", "Bearer invalid"))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/auth/login-id/availability"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/auth/login/extra")).andExpect(status().isUnauthorized());
        // 공개는 정확한 경로만이다(S15P31E105-560): 하위 경로·다른 메서드는 회원 체인으로 간다.
        mvc.perform(post("/api/v1/auth/phone-verifications/other"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/password-reset/extra")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/images/550e8400-e29b-41d4-a716-446655440000"))
                .andExpect(status().isOk())
                .andExpect(content().string("public-image"));
        mvc.perform(
                        get("/api/v1/images/550e8400-e29b-41d4-a716-446655440000")
                                .header("Authorization", "Bearer invalid"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/images/not-a-uuid"))
                .andExpect(status().isOk())
                .andExpect(content().string("public-image"));
        mvc.perform(post("/api/v1/images/550e8400-e29b-41d4-a716-446655440000"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/images/a/b")).andExpect(status().isUnauthorized());
    }

    @Test
    void 인증실패_오류구조와_배포점검_404를_유지한다() throws Exception {
        mvc.perform(get("/__test/who").header("X-User-Id", "17"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", "Bearer"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.message").value("인증이 필요합니다."))
                .andExpect(
                        content()
                                .json(
                                        "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다.\",\"details\":{}}"));
        mvc.perform(get("/")).andExpect(status().isNotFound());
        mvc.perform(head("/")).andExpect(status().isNotFound());
        mvc.perform(get("/error")).andExpect(status().isUnauthorized());
        mvc.perform(get("/missing").header("Authorization", SecurityTestSupport.bearer(17)))
                .andExpect(status().isNotFound());
    }

    @Test
    void 잘못된헤더_본문쿼리토큰과_문서인증은_회원인증이_아니다() throws Exception {
        for (String value : new String[] {"", "Bearer ", "Bearer invalid", "Basic dGVzdDp0ZXN0"}) {
            mvc.perform(get("/__test/who").header("Authorization", value))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(
                        get("/__test/who")
                                .header(
                                        "Authorization",
                                        SecurityTestSupport.bearer(17),
                                        SecurityTestSupport.bearer(18)))
                .andExpect(status().isUnauthorized());
        mvc.perform(
                        get("/__test/who")
                                .param("access_token", SecurityTestSupport.bearer(17).substring(7)))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/__test/who").contentType("application/json").content("broken"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void 검증된사용자만_전달하고_다음요청에_잔류하지않는다() throws Exception {
        mvc.perform(
                        get("/__test/who")
                                .header("Authorization", SecurityTestSupport.bearer(17))
                                .header("X-User-Id", "18"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(17));
        mvc.perform(get("/__test/who")).andExpect(status().isUnauthorized());
    }

    @Test
    void 두요청을_겹쳐실행해도_주체가_섞이지않는다() throws Exception {
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first =
                    pool.submit(
                            () ->
                                    mvc.perform(
                                                    get("/__test/parallel")
                                                            .header(
                                                                    "Authorization",
                                                                    SecurityTestSupport.bearer(17)))
                                            .andExpect(status().isOk())
                                            .andExpect(jsonPath("$.id").value(17))
                                            .andExpect(jsonPath("$.contextId").value(17)));
            var second =
                    pool.submit(
                            () ->
                                    mvc.perform(
                                                    get("/__test/parallel")
                                                            .header(
                                                                    "Authorization",
                                                                    SecurityTestSupport.bearer(18)))
                                            .andExpect(status().isOk())
                                            .andExpect(jsonPath("$.id").value(18))
                                            .andExpect(jsonPath("$.contextId").value(18)));
            first.get(20, TimeUnit.SECONDS);
            second.get(20, TimeUnit.SECONDS);
        }
    }

    @Test
    void 로컬문서와_OpenAPI인증요구를_제공한다() throws Exception {
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.components.securitySchemes.bearerAuth.scheme").value("bearer"))
                .andExpect(jsonPath("$.security[0].bearerAuth").isArray())
                .andExpect(jsonPath("$.paths['/api/v1/auth/login'].post.security").isEmpty());
    }
}
