package com.runway.backend.domain.readiness.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 254 AC-11. 평가 대상 날짜 계산. 저장소는 "건강 행이 있는 날짜" 조회만 대체하고, 조회 범위와 결과 집합을 확인한다. */
class ReadinessEvaluationServiceTest {

    private static final LocalDate D = LocalDate.of(2026, 10, 1);

    private final ReadinessJdbcRepository repository = mock(ReadinessJdbcRepository.class);
    /** 기존 사례의 날짜 범위와 겹치지 않는 KST 오늘. 오늘 후보(S15P31E105-836)가 기존 사례 결과를 바꾸지 않는다. */
    private static final LocalDate FAR_TODAY = LocalDate.of(2027, 6, 1);

    private final ReadinessEvaluationService service =
            new ReadinessEvaluationService(repository, kstClock(FAR_TODAY));

    /** KST 날짜 today 00:05에 고정한 UTC 시계(서버 시계는 UTC다). */
    private static Clock kstClock(LocalDate today) {
        return Clock.fixed(
                today.atTime(0, 5).atZone(ZoneId.of("Asia/Seoul")).toInstant(), ZoneOffset.UTC);
    }

    private ReadinessEvaluationService serviceOn(LocalDate today) {
        return new ReadinessEvaluationService(repository, kstClock(today));
    }

    @Test
    void 바뀐_날짜와_이후_7일_중_건강_행이_있는_날짜를_오름차순으로_낸다() {
        when(repository.findMetricDates(anyLong(), eq(D.plusDays(1)), eq(D.plusDays(7))))
                .thenReturn(List.of(D.plusDays(1), D.plusDays(3), D.plusDays(7)));

        assertThat(service.targetDates(1L, List.of(D)))
                .containsExactly(D, D.plusDays(1), D.plusDays(3), D.plusDays(7));
    }

    @Test
    void 바뀐_날짜가_7일_넘게_떨어지면_사이의_빈_구간은_넣지_않는다() {
        LocalDate far = D.plusDays(20);
        // 조회 범위는 D+1 ~ far+7. D+8~D+20 사이의 행은 어느 바뀐 날짜의 7일 안에도 없으므로 빠져야 한다.
        when(repository.findMetricDates(anyLong(), eq(D.plusDays(1)), eq(far.plusDays(7))))
                .thenReturn(
                        List.of(
                                D.plusDays(2),
                                D.plusDays(7),
                                D.plusDays(8),
                                D.plusDays(15),
                                far.plusDays(1),
                                far.plusDays(7)));

        assertThat(service.targetDates(1L, List.of(far, D)))
                .containsExactly(D, D.plusDays(2), D.plusDays(7), far, far.plusDays(1), far.plusDays(7));
    }

    /** 599 AC-6. 부하가 바뀐 날짜는 D+1~D+27 중 건강 행이 있는 날짜까지 평가한다. */
    @Test
    void 부하가_바뀐_날짜는_이후_27일까지_평가한다() {
        when(repository.findMetricDates(anyLong(), eq(D.plusDays(1)), eq(D.plusDays(27))))
                .thenReturn(List.of(D.plusDays(5), D.plusDays(20), D.plusDays(27)));

        assertThat(service.targetDates(1L, List.of(D), List.of(D)))
                .containsExactly(D, D.plusDays(5), D.plusDays(20), D.plusDays(27));
    }

    @Test
    void 부하와_RHR이_다른_날짜에서_바뀌면_각자의_범위만_넣는다() {
        LocalDate rhrOnly = D.plusDays(30);
        when(repository.findMetricDates(anyLong(), eq(D.plusDays(1)), eq(rhrOnly.plusDays(27))))
                .thenReturn(
                        List.of(
                                D.plusDays(20),
                                D.plusDays(28),
                                rhrOnly.plusDays(5),
                                rhrOnly.plusDays(10)));

        // D+28은 부하 창 밖, rhrOnly+10은 RHR 7일 창 밖이다.
        assertThat(service.targetDates(1L, List.of(D, rhrOnly), List.of(D)))
                .containsExactly(D, D.plusDays(20), rhrOnly, rhrOnly.plusDays(5));
    }

    @Test
    void 바뀐_날짜가_없으면_조회하지_않고_빈_목록() {
        assertThat(service.targetDates(1L, List.of())).isEmpty();
    }

    /** 836 AC-1. 과거 날짜가 바뀌면 건강 행이 없는 KST 오늘도 평가한다(수면 D1·D2, 부하 28일 창). */
    @Test
    void 과거_날짜가_바뀌면_행이_없는_오늘도_평가한다() {
        LocalDate today = D.plusDays(1);

        assertThat(serviceOn(today).targetDates(1L, List.of(D))).containsExactly(D, today);
    }

    /** 836 AC-1. KST 날짜가 UTC보다 하루 앞선 자정 직후에도 KST 오늘을 쓴다. */
    @Test
    void 오늘은_서버_UTC가_아니라_KST_날짜다() {
        LocalDate today = D.plusDays(1);
        // KST 00:05 = 전날 UTC 15:05. UTC 날짜(D)로 판단하면 오늘(D+1)이 빠진다.
        assertThat(serviceOn(today).targetDates(1L, List.of(D))).contains(today);
    }

    /** 836 AC-2. 부하가 바뀐 날짜에서 27일째인 오늘은 넣고, 28일째면 넣지 않는다. */
    @Test
    void 부하_변경은_27일_창_안의_오늘만_넣는다() {
        LocalDate today = D.plusDays(27);
        assertThat(serviceOn(today).targetDates(1L, List.of(D), List.of(D)))
                .containsExactly(D, today);

        LocalDate tooLate = D.plusDays(28);
        assertThat(serviceOn(tooLate).targetDates(1L, List.of(D), List.of(D)))
                .containsExactly(D);
    }

    /** 836 AC-2. 부하가 아닌 변경은 7일 창 안의 오늘만 넣는다. */
    @Test
    void 부하가_아닌_변경은_7일_창_밖의_오늘을_넣지_않는다() {
        assertThat(serviceOn(D.plusDays(7)).targetDates(1L, List.of(D)))
                .containsExactly(D, D.plusDays(7));
        assertThat(serviceOn(D.plusDays(8)).targetDates(1L, List.of(D))).containsExactly(D);
    }

    /** 836. 바뀐 날짜가 KST 오늘보다 뒤(워치 시간대가 앞선 경우)면 오늘을 넣지 않는다. */
    @Test
    void 바뀐_날짜보다_앞선_오늘은_넣지_않는다() {
        assertThat(serviceOn(D.minusDays(1)).targetDates(1L, List.of(D))).containsExactly(D);
    }
}
