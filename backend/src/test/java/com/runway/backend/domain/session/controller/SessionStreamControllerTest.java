package com.runway.backend.domain.session.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.session.service.RunningSessionService;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import com.runway.backend.global.security.AuthenticatedUser;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.BadJwtException;

/**
 * S10 토큰 만료시각 처리 — S15P31E105-257 리뷰 R-6/RR-3 회귀 확인. 인증 필터를 통과한 뒤 소유 검사가 늦어져 그 사이 토큰이 만료돼 다시 읽을 수 없으면
 * 스트림 제한시간을 1시간이 아니라 지금으로 둔다.
 */
class SessionStreamControllerTest {

    private final RunningSessionService sessions = mock(RunningSessionService.class);
    private final SessionStreamRegistry registry = mock(SessionStreamRegistry.class);
    private final JwtDecoder decoder = mock(JwtDecoder.class);
    private final SessionStreamController controller =
            new SessionStreamController(sessions, registry, decoder);

    @Test
    void 만료돼_다시_읽을_수_없는_토큰은_지금_만료된_것으로_구독한다() {
        when(decoder.decode(any())).thenThrow(new BadJwtException("expired"));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer synthetic.token.value");
        Instant before = Instant.now();

        controller.events(new AuthenticatedUser(1L), "5", request);

        ArgumentCaptor<Instant> expiry = ArgumentCaptor.forClass(Instant.class);
        verify(registry).subscribe(eq(1L), eq(5L), expiry.capture());
        assertThat(expiry.getValue()).isBetween(before, Instant.now());
        verify(sessions).get(eq(1L), eq(5L), any());
    }

    @Test
    void 토큰_만료시각은_소유_검사보다_먼저_읽는다() {
        Instant tokenExpiry = Instant.now().plusSeconds(30);
        org.springframework.security.oauth2.jwt.Jwt jwt =
                org.springframework.security.oauth2.jwt.Jwt.withTokenValue("t")
                        .header("alg", "HS256")
                        .subject("1")
                        .expiresAt(tokenExpiry)
                        .issuedAt(Instant.now())
                        .build();
        java.util.List<String> order = new java.util.ArrayList<>();
        when(decoder.decode(any()))
                .thenAnswer(
                        invocation -> {
                            order.add("decode");
                            return jwt;
                        });
        when(sessions.get(anyLong(), anyLong(), any()))
                .thenAnswer(
                        invocation -> {
                            order.add("ownership");
                            return null;
                        });
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer synthetic.token.value");

        controller.events(new AuthenticatedUser(1L), "5", request);

        assertThat(order).containsExactly("decode", "ownership");
        verify(registry).subscribe(1L, 5L, tokenExpiry);
    }
}
