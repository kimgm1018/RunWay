package com.runway.backend.domain.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.course.elevation.CourseElevationSource;
import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.domain.device.repository.ConsentJdbcRepository;
import com.runway.backend.domain.user.model.HrPersonalizationCommand;
import com.runway.backend.domain.user.personalization.Ai06PersonalizeRequest;
import com.runway.backend.domain.user.personalization.Ai06Session;
import com.runway.backend.domain.user.personalization.HrPersonalizePort;
import com.runway.backend.domain.user.personalization.HrPersonalizeResult;
import com.runway.backend.domain.user.personalization.W07Session;
import com.runway.backend.domain.user.personalization.W07ToAi06Converter;
import com.runway.backend.domain.user.repository.W07PersonalizationSessionRepository;
import com.runway.backend.domain.user.repository.W07PersonalizationSessionRepository.SessionHeader;
import com.runway.backend.domain.user.service.HrPersonalizationRunService.Outcome;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class HrPersonalizationRunServiceTest {

    private static final long USER_ID = 7L;
    private static final Instant STARTED = Instant.parse("2026-11-01T00:00:00Z");

    private final W07PersonalizationSessionRepository sessionRepository =
            mock(W07PersonalizationSessionRepository.class);
    private final ConsentJdbcRepository consentRepository = mock(ConsentJdbcRepository.class);
    private final W07ToAi06Converter converter = mock(W07ToAi06Converter.class);
    private final HrPersonalizePort aiPort = mock(HrPersonalizePort.class);
    private final HrPersonalizationService personalizationService =
            mock(HrPersonalizationService.class);
    private ElevationSource elevation;

    private HrPersonalizationRunService service() {
        return new HrPersonalizationRunService(
                sessionRepository,
                consentRepository,
                converter,
                new CourseElevationSource(Optional.ofNullable(elevation)),
                aiPort,
                personalizationService);
    }

    private static HrPersonalizationCommand command() {
        return new HrPersonalizationCommand(
                "runway.ode.personalization.v1",
                "ode-1",
                3,
                "{\"a\":1}",
                "[[1,2,3,4,5]]",
                "[1,2,3,4]",
                BigDecimal.valueOf(85),
                null,
                null,
                null,
                null);
    }

    private static Ai06Session session(long id) {
        return new Ai06Session(id, STARTED, Ai06Session.WorkoutQuality.CLEAN, List.of());
    }

    private void consent(boolean granted) {
        when(consentRepository.findActiveUserConsent(USER_ID)).thenReturn(Optional.of(granted));
    }

    private void completedSessions(int count) {
        List<SessionHeader> headers = new ArrayList<>();
        for (int i = 1; i <= count; i++) {
            headers.add(new SessionHeader(i, STARTED.minusSeconds(i)));
        }
        when(sessionRepository.findCompletedSessions(eq(USER_ID), anyInt())).thenReturn(headers);
        when(sessionRepository.findSamples(anyLong())).thenReturn(List.of());
        when(sessionRepository.findRoutePoints(anyLong())).thenReturn(List.of());
    }

    @Test
    void 세션의_회원을_조회한다() {
        when(sessionRepository.findUserIdBySessionId(10L)).thenReturn(Optional.of(USER_ID));

        assertThat(service().findUserId(10L)).contains(USER_ID);
    }

    @Test
    void 동의하지_않은_회원은_읽지도_호출하지도_않는다() {
        consent(false);

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.SKIPPED_NO_CONSENT);

        verifyNoInteractions(sessionRepository, converter, aiPort, personalizationService);
    }

    @Test
    void 활성_회원이_아니면_스킵한다() {
        when(consentRepository.findActiveUserConsent(USER_ID)).thenReturn(Optional.empty());

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.SKIPPED_NO_CONSENT);

        verifyNoInteractions(sessionRepository, converter, aiPort, personalizationService);
    }

    @Test
    void 변환된_세션이_없으면_AI를_호출하지_않는다() {
        consent(true);
        completedSessions(3);
        when(converter.convert(any(W07Session.class), any())).thenReturn(Optional.empty());

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.SKIPPED_NO_SESSIONS);

        verifyNoInteractions(aiPort, personalizationService);
    }

    @Test
    void 완료_러닝이_없으면_AI를_호출하지_않는다() {
        consent(true);
        completedSessions(0);

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.SKIPPED_NO_SESSIONS);

        verifyNoInteractions(converter, aiPort, personalizationService);
    }

    @Test
    void 성공_응답은_다음_버전으로_저장한다() {
        consent(true);
        completedSessions(2);
        when(converter.convert(any(W07Session.class), any()))
                .thenAnswer(
                        invocation ->
                                Optional.of(
                                        session(
                                                invocation
                                                        .<W07Session>getArgument(0)
                                                        .sessionId())));
        HrPersonalizationCommand command = command();
        when(aiPort.personalize(any())).thenReturn(new HrPersonalizeResult.Success(command));

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.SAVED);

        ArgumentCaptor<Ai06PersonalizeRequest> request =
                ArgumentCaptor.forClass(Ai06PersonalizeRequest.class);
        verify(aiPort).personalize(request.capture());
        assertThat(request.getValue().userId()).isEqualTo(USER_ID);
        assertThat(request.getValue().sessions())
                .extracting(Ai06Session::sessionId)
                .containsExactly(1L, 2L);
        verify(personalizationService).saveNextVersion(USER_ID, command);
    }

    @Test
    void 입력_부족_응답은_저장하지_않는다() {
        consent(true);
        completedSessions(1);
        when(converter.convert(any(W07Session.class), any())).thenReturn(Optional.of(session(1)));
        when(aiPort.personalize(any())).thenReturn(new HrPersonalizeResult.InputInsufficient());

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.SKIPPED_INPUT_INSUFFICIENT);

        verifyNoInteractions(personalizationService);
    }

    @Test
    void 호출_실패는_저장하지_않는다() {
        consent(true);
        completedSessions(1);
        when(converter.convert(any(W07Session.class), any())).thenReturn(Optional.of(session(1)));
        when(aiPort.personalize(any()))
                .thenReturn(
                        new HrPersonalizeResult.Failure(
                                HrPersonalizeResult.Reason.BUSY_RETRIES_EXHAUSTED, 503));

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.FAILED_AI);

        verifyNoInteractions(personalizationService);
    }

    @Test
    void 저장_실패는_예외를_전파하지_않고_결과로_돌려준다() {
        consent(true);
        completedSessions(1);
        when(converter.convert(any(W07Session.class), any())).thenReturn(Optional.of(session(1)));
        when(aiPort.personalize(any())).thenReturn(new HrPersonalizeResult.Success(command()));
        when(personalizationService.saveNextVersion(anyLong(), any()))
                .thenThrow(new IllegalArgumentException("invalid"));

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.FAILED_SAVE);
    }

    @Test
    void 변환_성공_러닝은_50개까지만_보낸다() {
        consent(true);
        completedSessions(80);
        when(converter.convert(any(W07Session.class), any()))
                .thenAnswer(
                        invocation ->
                                Optional.of(
                                        session(
                                                invocation
                                                        .<W07Session>getArgument(0)
                                                        .sessionId())));
        when(aiPort.personalize(any())).thenReturn(new HrPersonalizeResult.InputInsufficient());

        service().runForUser(USER_ID);

        ArgumentCaptor<Ai06PersonalizeRequest> request =
                ArgumentCaptor.forClass(Ai06PersonalizeRequest.class);
        verify(aiPort).personalize(request.capture());
        assertThat(request.getValue().sessions()).hasSize(50);
        verify(sessionRepository, times(50)).findSamples(anyLong());
    }

    @Test
    void 변환에_실패한_러닝은_건너뛰고_다음_후보로_채운다() {
        consent(true);
        completedSessions(6);
        // 홀수 ID 러닝만 변환에 성공한다.
        when(converter.convert(any(W07Session.class), any()))
                .thenAnswer(
                        invocation -> {
                            long id = invocation.<W07Session>getArgument(0).sessionId();
                            return id % 2 == 1 ? Optional.of(session(id)) : Optional.empty();
                        });
        when(aiPort.personalize(any())).thenReturn(new HrPersonalizeResult.InputInsufficient());

        service().runForUser(USER_ID);

        ArgumentCaptor<Ai06PersonalizeRequest> request =
                ArgumentCaptor.forClass(Ai06PersonalizeRequest.class);
        verify(aiPort).personalize(request.capture());
        assertThat(request.getValue().sessions())
                .extracting(Ai06Session::sessionId)
                .containsExactly(1L, 3L, 5L);
    }

    @Test
    void 호출_직전에_동의가_철회되면_호출하지_않는다() {
        when(consentRepository.findActiveUserConsent(USER_ID))
                .thenReturn(Optional.of(true), Optional.of(false));
        completedSessions(1);
        when(converter.convert(any(W07Session.class), any())).thenReturn(Optional.of(session(1)));

        assertThat(service().runForUser(USER_ID)).isEqualTo(Outcome.SKIPPED_NO_CONSENT);

        verifyNoInteractions(aiPort, personalizationService);
    }

    @Test
    void DEM이_없으면_변환기에_null_고도를_넘긴다() {
        consent(true);
        completedSessions(1);
        when(converter.convert(any(W07Session.class), isNull())).thenReturn(Optional.empty());

        service().runForUser(USER_ID);

        verify(converter).convert(any(W07Session.class), isNull());
        verify(aiPort, never()).personalize(any());
    }

    @Test
    void DEM이_있으면_변환기에_고도_조회를_넘긴다() {
        elevation = (lon, lat) -> 10.0;
        consent(true);
        completedSessions(1);
        when(converter.convert(any(W07Session.class), any(ElevationSource.class))).thenReturn(Optional.empty());

        service().runForUser(USER_ID);

        // 서비스는 실행마다 DEM 실패를 결측으로 바꾸는 래퍼(W07ToAi06Converter.demForRun)를 넘긴다(S15P31E105-590).
        ArgumentCaptor<ElevationSource> passed = ArgumentCaptor.forClass(ElevationSource.class);
        verify(converter).convert(any(W07Session.class), passed.capture());
        assertThat(passed.getValue().elevationAt(129.0, 35.1)).isEqualTo(10.0);
    }
}
