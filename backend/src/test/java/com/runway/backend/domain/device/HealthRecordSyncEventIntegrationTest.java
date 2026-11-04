package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/** W06 AC-10. 값이 실제로 저장·갱신된 날짜만 커밋 후 이벤트로 알리고, 조회나 별도 평가 요청 없이 발행된다. */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class HealthRecordSyncEventIntegrationTest extends HealthRecordSyncIntegrationSupport {

    @Test
    void 저장한_날짜를_커밋_후_한_번_알린다() throws Exception {
        LocalDate date = today();

        mockMvc.perform(healthRequest(userId, healthBody(estimate(date, 1, "58.4"))))
                .andExpect(status().isOk());

        assertThat(events.committed)
                .containsExactly(new DailyHealthMetricsChangedEvent(userId, List.of(date)));
    }

    @Test
    void 여러_날짜는_중복_없이_오름차순으로_한_이벤트에_담는다() throws Exception {
        LocalDate later = today();
        LocalDate earlier = today().minusDays(1);

        mockMvc.perform(
                        healthRequest(
                                userId,
                                healthBody(
                                        estimate(later, 1, "58.4"),
                                        estimate(earlier, 1, "59.0"),
                                        estimate(later, 2, "58.0"))))
                .andExpect(status().isOk());

        assertThat(events.committed)
                .containsExactly(
                        new DailyHealthMetricsChangedEvent(userId, List.of(earlier, later)));
    }

    /** 발행 뒤 같은 트랜잭션이 롤백되면 커밋 후 구독자는 이벤트를 받지 않고 저장도 남지 않는다. */
    @Test
    void 발행_뒤_롤백되면_커밋_후_구독자에게_전달되지_않는다() throws Exception {
        events.failOnPublish = true;

        mockMvc.perform(healthRequest(userId, healthBody(estimate(today(), 1, "58.4"))))
                .andExpect(status().isInternalServerError());

        assertThat(events.published).hasSize(1);
        // 커밋 후 리스너가 등록된 상태에서 롤백됐음을 확인한다(등록 전에 예외가 났다면 rolledBack도 비어 있다).
        assertThat(events.rolledBack).hasSize(1);
        assertThat(events.committed).isEmpty();
        assertThat(healthRows()).isZero();
    }

    @Test
    void 모두_duplicate이면_알리지_않는다() throws Exception {
        String body = healthBody(estimate(today(), 1, "58.4"));
        mockMvc.perform(healthRequest(userId, body)).andExpect(status().isOk());
        events.clear();

        mockMvc.perform(healthRequest(userId, body)).andExpect(status().isOk());

        assertThat(events.published).isEmpty();
        assertThat(events.committed).isEmpty();
    }

    @Test
    void 모두_거절되거나_동의가_없으면_알리지_않는다() throws Exception {
        mockMvc.perform(healthRequest(userId, healthBody(estimate(today(), 0, "58.4"))))
                .andExpect(status().isOk());
        long disagree = insertUser("DISAGREE");
        mockMvc.perform(healthRequest(disagree, healthBody(estimate(today(), 1, "58.4"))))
                .andExpect(status().isForbidden());

        assertThat(events.published).isEmpty();
        assertThat(events.committed).isEmpty();
    }
}
