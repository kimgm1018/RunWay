package com.runway.backend.global.config;

import com.runway.backend.global.exception.ApiErrorResponse;
import com.runway.backend.global.exception.ErrorCode;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.Map;
import java.util.Set;

/**
 * PUT·PATCH·DELETE의 {@code application/x-www-form-urlencoded} 본문을 막는다(S15P31E105-827).
 *
 * <p>이 저장소의 API는 이 세 메서드에 폼 본문을 쓰지 않는다. 그런데 Spring의 {@code FormContentFilter}는 그 본문을
 * {@code URLDecoder}로 직접 푸는데, 깨진 퍼센트 인코딩(`%zz`)이 던지는 {@code IllegalArgumentException}을 어떤
 * {@code @ExceptionHandler}도 잡지 못해(필터 체인에서 발생, DispatcherServlet 밖) Boot 기본 {@code /error}로 가서
 * 500이 났다. 깨진 UTF-8 바이트는 예외 없이 {@code U+FFFD}로 조용히 바뀌어 들어가기도 했다.
 *
 * <p>그 디코딩 결과를 구분해 가려내는 대신, 이 메서드들의 폼 본문 자체를 {@code FormContentFilter}가 손대기 전에
 * 거절한다(Jira 완료 조건의 두 대안 중 "폼 본문을 받지 않도록 막는" 쪽, 2026-11-14 결정). 헤더·메서드만 보고 본문은
 * 읽지 않으므로 정상/깨진 인코딩을 구분하지 않고 일괄 400 VALIDATION_ERROR로 응답한다.
 */
@Configuration(proxyBeanMethods = false)
public class FormBodyGuardConfig {

    @Bean
    FilterRegistrationBean<FormBodyGuardFilter> formBodyGuardFilter(JsonMapper mapper) {
        FilterRegistrationBean<FormBodyGuardFilter> registration =
                new FilterRegistrationBean<>(new FormBodyGuardFilter(mapper));
        // Spring Security 필터 체인·FormContentFilter보다 먼저 실행되어야 폼 본문을 그 전에 거절할 수 있다.
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
        registration.addUrlPatterns("/*");
        return registration;
    }

    static final class FormBodyGuardFilter extends OncePerRequestFilter {
        private static final Set<String> BLOCKED_METHODS = Set.of("PUT", "PATCH", "DELETE");

        private final JsonMapper mapper;

        FormBodyGuardFilter(JsonMapper mapper) {
            this.mapper = mapper;
        }

        @Override
        protected void doFilterInternal(
                HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            if (BLOCKED_METHODS.contains(request.getMethod()) && isFormUrlEncoded(request)) {
                writeValidationError(response);
                return;
            }
            chain.doFilter(request, response);
        }

        private boolean isFormUrlEncoded(HttpServletRequest request) {
            String contentType = request.getContentType();
            if (contentType == null) {
                return false;
            }
            try {
                return MediaType.APPLICATION_FORM_URLENCODED.includes(
                        MediaType.parseMediaType(contentType));
            } catch (InvalidMediaTypeException exception) {
                // 다른 처리기(예: 405·415 분기)가 이미 다루는 영역이라 여기서는 통과시킨다.
                return false;
            }
        }

        private void writeValidationError(HttpServletResponse response) throws IOException {
            response.setStatus(ErrorCode.VALIDATION_ERROR.status().value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            mapper.writeValue(
                    response.getOutputStream(),
                    ApiErrorResponse.of(ErrorCode.VALIDATION_ERROR, Map.of()));
        }
    }
}
