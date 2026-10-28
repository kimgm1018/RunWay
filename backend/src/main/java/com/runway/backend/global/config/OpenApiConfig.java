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
                                                .bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList("bearerAuth"))
                .info(
                        new Info()
                                .title("RunWay API")
                                .description("RunWay 백엔드 API")
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
