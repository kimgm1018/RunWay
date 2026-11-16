package com.runway.backend.domain.readiness.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.notification.NotificationType;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.domain.readiness.formula.ReadinessConfidence;
import com.runway.backend.domain.readiness.formula.ReadinessScore;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository.PushReadiness;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** 847 AC-1(본문 표기)·AC-3(발송 시각)·AC-4(결과 없음). 알림 생성·DB는 통합 테스트가 본다. */
class ReadinessPushNotifierTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 16);

    private final ReadinessJdbcRepository repository = mock(ReadinessJdbcRepository.class);
    private final NotificationService notifications = mock(NotificationService.class);

    private ReadinessPushNotifier at(int hour, int minute) {
        Clock clock =
                Clock.fixed(
                        LocalDateTime.of(DAY, java.time.LocalTime.of(hour, minute))
                                .atZone(ReadinessEvaluationService.TODAY_ZONE)
                                .toInstant(),
                        java.time.ZoneOffset.UTC);
        return new ReadinessPushNotifier(repository, notifications, clock);
    }

    @Test
    void 본문은_앱과_같은_점수_표기를_쓴다() {
        assertThat(ReadinessPushNotifier.message(new BigDecimal("72.50")))
                .isEqualTo("오늘 준비도는 72.5점입니다. 달리러 가볼까요?");
        assertThat(ReadinessPushNotifier.message(new BigDecimal("80.00")))
                .isEqualTo("오늘 준비도는 80점입니다. 달리러 가볼까요?");
        assertThat(ReadinessPushNotifier.message(new BigDecimal("65.25")))
                .isEqualTo("오늘 준비도는 65.25점입니다. 달리러 가볼까요?");
        assertThat(ReadinessPushNotifier.message(new BigDecimal("100.00")))
                .isEqualTo("오늘 준비도는 100점입니다. 달리러 가볼까요?");
        assertThat(ReadinessPushNotifier.message(new BigDecimal("0.00")))
                .isEqualTo("오늘 준비도는 0점입니다. 달리러 가볼까요?");
    }

    @Test
    void 결과가_있으면_오늘_준비도_알림을_회원_날짜_키로_만든다() {
        when(repository.findPushReadiness(7L, DAY))
                .thenReturn(Optional.of(new PushReadiness(42L, new BigDecimal("72.50"))));
        when(notifications.create(anyLong(), any(), anyLong(), any(), any())).thenReturn(true);

        assertThat(at(8, 0).send(7L, DAY)).isTrue();

        verify(notifications)
                .create(
                        7L,
                        NotificationType.READINESS_TODAY,
                        42L,
                        "오늘 준비도는 72.5점입니다. 달리러 가볼까요?",
                        "READINESS_TODAY:7:2026-11-16");
    }

    @Test
    void 결과가_없으면_알림을_만들지_않는다() {
        when(repository.findPushReadiness(7L, DAY)).thenReturn(Optional.empty());

        assertThat(at(9, 0).send(7L, DAY)).isFalse();

        verifyNoInteractions(notifications);
    }

    @Test
    void 이벤트_평가는_KST_08시부터_오늘만_보낸다() {
        when(repository.findPushReadiness(7L, DAY))
                .thenReturn(Optional.of(new PushReadiness(42L, new BigDecimal("70.00"))));
        when(notifications.create(anyLong(), any(), anyLong(), any(), any())).thenReturn(true);

        assertThat(at(0, 5).notifyIfDue(7L, DAY)).isFalse();
        assertThat(at(7, 59).notifyIfDue(7L, DAY)).isFalse();
        assertThat(at(9, 0).notifyIfDue(7L, DAY.minusDays(1))).isFalse();
        verify(notifications, never()).create(anyLong(), any(), anyLong(), any(), any());

        assertThat(at(8, 0).notifyIfDue(7L, DAY)).isTrue();
        assertThat(at(23, 59).notifyIfDue(7L, DAY)).isTrue();
    }

    /** 847 AC-3. 이벤트 평가가 결과를 저장한 날짜만 알리미에 넘기고, 알리미 실패는 다음 날짜 평가를 막지 않는다. */
    @Test
    void 평가_실행기는_저장한_날짜만_알리미에_넘긴다() throws Exception {
        ReadinessEvaluationService service = mock(ReadinessEvaluationService.class);
        ReadinessPushNotifier notifier = mock(ReadinessPushNotifier.class);
        LocalDate other = DAY.minusDays(1);
        when(service.targetDates(7L, List.of(DAY), List.of())).thenReturn(List.of(other, DAY));
        when(service.evaluate(7L, other)).thenReturn(Optional.empty());
        when(service.evaluate(7L, DAY))
                .thenReturn(
                        Optional.of(
                                new ReadinessScore(
                                        new BigDecimal("70.00"),
                                        ReadinessConfidence.LOW,
                                        new BigDecimal("70.00"),
                                        null,
                                        null,
                                        null)));
        when(notifier.notifyIfDue(7L, DAY)).thenThrow(new IllegalStateException("synthetic"));
        var dispatcher = new ReadinessEvaluationDispatcher(service, notifier);
        try {
            dispatcher.dispatch(7L, List.of(DAY));
            assertThat(dispatcher.awaitIdle(java.time.Duration.ofSeconds(5))).isTrue();
        } finally {
            dispatcher.destroy();
        }

        verify(notifier).notifyIfDue(7L, DAY);
        verify(notifier, never()).notifyIfDue(7L, other);
    }
}
