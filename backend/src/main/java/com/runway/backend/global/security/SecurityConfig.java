package com.runway.backend.global.security;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.runway.backend.global.exception.ApiErrorResponse;
import com.runway.backend.global.exception.ErrorCode;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.util.matcher.RequestMatcher;

import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.time.Clock;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    @Order(0)
    SecurityFilterChain managementSecurity(HttpSecurity http, Environment environment)
            throws Exception {
        http.securityMatcher(
                        request ->
                                managementPort(request, environment)
                                        || request.getRequestURI().startsWith("/actuator"))
                .sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(csrf -> csrf.disable())
                .requestCache(cache -> cache.disable())
                .authorizeHttpRequests(
                        auth ->
                                auth.requestMatchers(
                                                request ->
                                                        managementPort(request, environment)
                                                                && request.getLocalAddr()
                                                                        .equals("127.0.0.1")
                                                                && request.getRemoteAddr()
                                                                        .equals("127.0.0.1")
                                                                && request.getMethod().equals("GET")
                                                                && request.getRequestURI()
                                                                        .equals(
                                                                                "/actuator/health/readiness"))
                                        .permitAll()
                                        .anyRequest()
                                        .denyAll());
        return http.build();
    }

    private static boolean managementPort(HttpServletRequest request, Environment environment) {
        int port =
                environment.getProperty(
                        "local.management.port",
                        Integer.class,
                        environment.getProperty("management.server.port", Integer.class, 8082));
        return request.getLocalPort() == port;
    }

    @Bean
    SecuritySettings securitySettings(Environment environment) {
        return new SecuritySettings(environment);
    }

    @Bean
    Clock authenticationClock() {
        return Clock.systemUTC();
    }

    @Bean
    JwtEncoder jwtEncoder(SecuritySettings settings) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(settings.signingKey()));
    }

    @Bean
    JwtDecoder jwtDecoder(SecuritySettings settings, Clock authenticationClock) {
        NimbusJwtDecoder decoder =
                NimbusJwtDecoder.withSecretKey(settings.signingKey())
                        .macAlgorithm(MacAlgorithm.HS256)
                        .build();
        decoder.setJwtValidator(new JwtAccessTokenValidator(authenticationClock));
        return decoder;
    }

    @Bean
    JwtAccessTokenService jwtAccessTokenService(JwtEncoder jwtEncoder, Clock authenticationClock) {
        return new JwtAccessTokenService(jwtEncoder, authenticationClock);
    }

    @Bean
    @Order(1)
    SecurityFilterChain documentationSecurity(
            HttpSecurity http, SecuritySettings settings, JsonMapper mapper) throws Exception {
        http.securityMatcher(SecurityConfig::isDocumentationRequest)
                .sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .authorizeHttpRequests(
                        auth -> {
                            RequestMatcher read =
                                    request -> List.of("GET", "HEAD").contains(request.getMethod());
                            // 로컬에서는 문서를 바로 열고, 공유 서버에서는 문서 계정을 확인한다.
                            if (settings.localDocs()) {
                                auth.requestMatchers(read).permitAll();
                            } else {
                                auth.requestMatchers(read).hasRole("DOCS");
                            }
                            auth.anyRequest().denyAll();
                        })
                .exceptionHandling(
                        errors ->
                                errors.accessDeniedHandler(
                                        (request, response, exception) ->
                                                writeError(response, mapper, ErrorCode.FORBIDDEN)));
        if (!settings.localDocs()) {
            var users =
                    new InMemoryUserDetailsManager(
                            User.withUsername(settings.docsUsername())
                                    .password(settings.docsPasswordHash())
                                    .roles("DOCS")
                                    .build());
            var provider = new DaoAuthenticationProvider(users);
            provider.setPasswordEncoder(PasswordEncoderFactories.createDelegatingPasswordEncoder());
            http.authenticationProvider(provider)
                    .httpBasic(
                            basic ->
                                    basic.authenticationEntryPoint(
                                            (request, response, exception) -> {
                                                response.setHeader(
                                                        HttpHeaders.WWW_AUTHENTICATE,
                                                        "Basic realm=\"RunWay Docs\"");
                                                writeError(
                                                        response, mapper, ErrorCode.UNAUTHORIZED);
                                            }));
        }
        return http.build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain publicSecurity(HttpSecurity http) throws Exception {
        http.securityMatcher(SecurityConfig::isPublicRequest)
                .sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(csrf -> csrf.disable())
                .requestCache(cache -> cache.disable())
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        return http.build();
    }

    @Bean
    @Order(3)
    SecurityFilterChain memberSecurity(HttpSecurity http, JwtDecoder decoder, JsonMapper mapper)
            throws Exception {
        http.sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(csrf -> csrf.disable())
                .requestCache(cache -> cache.disable())
                .authorizeHttpRequests(
                        auth ->
                                auth.dispatcherTypeMatchers(DispatcherType.ERROR)
                                        .permitAll()
                                        .anyRequest()
                                        .authenticated())
                .exceptionHandling(
                        errors ->
                                errors.authenticationEntryPoint(
                                                (request, response, exception) ->
                                                        unauthorized(response, mapper))
                                        .accessDeniedHandler(
                                                (request, response, exception) ->
                                                        writeError(
                                                                response,
                                                                mapper,
                                                                ErrorCode.FORBIDDEN)))
                .oauth2ResourceServer(
                        resource -> {
                            // Authorization 헤더에서 Bearer 토큰을 추출한다.
                            resource.bearerTokenResolver(SecurityConfig::resolveBearer);
                            resource.authenticationEntryPoint(
                                    (request, response, exception) ->
                                            unauthorized(response, mapper));

                            resource.jwt(
                                    jwt -> {
                                        // 서명과 RunWay의 토큰 규칙을 검증한다.
                                        jwt.decoder(decoder);
                                        // 검증된 사용자 ID를 이번 요청의 인증 정보에 담는다.
                                        jwt.jwtAuthenticationConverter(
                                                token -> {
                                                    long userId =
                                                            Long.parseLong(token.getSubject());
                                                    var user = new AuthenticatedUser(userId);
                                                    return UsernamePasswordAuthenticationToken
                                                            .authenticated(user, null, List.of());
                                                });
                                    });
                        });
        return http.build();
    }

    public static boolean isPublicRequest(HttpServletRequest request) {
        String path = request.getServletPath();
        if (path.isEmpty()) {
            path = request.getRequestURI().substring(request.getContextPath().length());
        }
        return isPublicEndpoint(request.getMethod(), path);
    }

    private static final String PUBLIC_IMAGE_PREFIX = "/api/v1/images/";

    public static boolean isPublicEndpoint(String method, String path) {
        return (List.of("GET", "HEAD").contains(method) && path.equals("/"))
                || (method.equals("POST")
                        && List.of(
                                        "/api/v1/auth/login",
                                        "/api/v1/auth/signup",
                                        "/api/v1/auth/refresh",
                                        "/api/v1/auth/logout")
                                .contains(path))
                || (method.equals("GET") && path.equals("/api/v1/auth/login-id/availability"))
                || (List.of("GET", "HEAD").contains(method) && isPublicImagePath(path));
    }

    /** F02: GET/HEAD `/api/v1/images/{imageId}` only. UUID 검증은 컨트롤러에서 400으로 처리한다. */
    private static boolean isPublicImagePath(String path) {
        if (!path.startsWith(PUBLIC_IMAGE_PREFIX)) {
            return false;
        }
        String imageId = path.substring(PUBLIC_IMAGE_PREFIX.length());
        return !imageId.isEmpty() && imageId.indexOf('/') < 0;
    }

    private static boolean isDocumentationRequest(HttpServletRequest request) {
        String path = request.getServletPath();
        if (path.isEmpty()) {
            path = request.getRequestURI().substring(request.getContextPath().length());
        }
        return path.equals("/swagger-ui.html")
                || path.startsWith("/swagger-ui/")
                || path.equals("/v3/api-docs")
                || path.startsWith("/v3/api-docs/")
                || path.equals("/v3/api-docs.yaml");
    }

    private static String resolveBearer(HttpServletRequest request) {
        if (Collections.list(request.getHeaders(HttpHeaders.AUTHORIZATION)).size() > 1) {
            throw new OAuth2AuthenticationException(new OAuth2Error("invalid_token"));
        }
        return new DefaultBearerTokenResolver().resolve(request);
    }

    private static void unauthorized(HttpServletResponse response, JsonMapper mapper)
            throws IOException {
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        writeError(response, mapper, ErrorCode.UNAUTHORIZED);
    }

    private static void writeError(
            HttpServletResponse response, JsonMapper mapper, ErrorCode errorCode)
            throws IOException {
        response.setStatus(errorCode.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(response.getOutputStream(), ApiErrorResponse.of(errorCode, Map.of()));
    }
}
