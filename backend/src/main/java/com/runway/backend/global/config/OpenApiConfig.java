package com.runway.backend.global.config;

import com.runway.backend.global.security.SecurityConfig;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import java.util.List;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class OpenApiConfig {

    @Bean
    OpenAPI runWayOpenApi() {
        return new OpenAPI()
                .components(
                        new Components()
                                .addSecuritySchemes(
                                        "bearerAuth",
                                        new SecurityScheme()
                                                .type(SecurityScheme.Type.HTTP)
                                                .scheme("bearer")
                                                .bearerFormat("JWT")
                                                .description(
                                                        """
                                                        Access Token(JWT)을 넣습니다. `Bearer ` 접두어는 넣지 마세요.

                                                        얻는 방법:
                                                        1. 아래 **POST /api/v1/auth/login** 을 연다 (Authorize 불필요)
                                                        2. body 예: `{"loginId":"본인아이디","password":"본인비밀번호"}`
                                                        3. 응답 JSON의 **accessToken** 값을 복사한다
                                                        4. 이 칸에 붙여넣고 Authorize

                                                        토큰은 짧게 만료됩니다. 401이면 다시 로그인하세요.
                                                        """)))
                .addSecurityItem(new SecurityRequirement().addList("bearerAuth"))
                .info(
                        new Info()
                                .title("RunWay API")
                                .description(
                                        """
                                        RunWay 백엔드 API

                                        ## 인증 (bearerAuth)
                                        1. `POST /api/v1/auth/login` 실행 → 응답 `accessToken` 복사
                                        2. 우측 **Authorize** → bearerAuth에 붙여넣기 (`Bearer ` 없이)
                                        3. 회원 API Execute
                                        """)
                                .version("v0.0.1"));
    }

    @Bean
    OpenApiCustomizer publicOperationSecurity() {
        return api -> {
            if (api.getPaths() == null) {
                return;
            }
            api.getPaths()
                    .forEach(
                            (path, item) ->
                                    item.readOperationsMap()
                                            .forEach(
                                                    (method, operation) -> {
                                                        if (SecurityConfig.isPublicEndpoint(
                                                                method.name(), path)) {
                                                            operation.setSecurity(List.of());
                                                        }
                                                    }));
        };
    }
}
