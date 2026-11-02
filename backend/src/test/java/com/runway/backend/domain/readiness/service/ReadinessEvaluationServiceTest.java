package com.runway.backend.domain.readiness.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 254 AC-11. 평가 대상 날짜 계산. 저장소는 "건강 행이 있는 날짜" 조회만 대체하고, 조회 범위와 결과 집합을 확인한다. */
class ReadinessEvaluationServiceTest {

    private static final LocalDate D = LocalDate.of(2026, 10, 1);

    private final ReadinessJdbcRepository repository = mock(ReadinessJdbcRepository.class);
    private final ReadinessEvaluationService service = new ReadinessEvaluationService(repository);

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

    @Test
    void 바뀐_날짜가_없으면_조회하지_않고_빈_목록() {
        assertThat(service.targetDates(1L, List.of())).isEmpty();
    }
}
