package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * W06 AC-9. 두 번째 쓰기에서 DB가 실패하면 앞 레코드도 롤백되고, 오류 본문·로그에 건강 값이 남지 않으며, 같은 요청 재전송으로 복구된다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class HealthRecordSyncFailureIntegrationTest extends HealthRecordSyncIntegrationSupport {

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void 저장_중_DB가_실패하면_모두_롤백되고_재전송으로_복구된다(CapturedOutput output) throws Exception {
        LocalDate first = today().minusDays(1);
        LocalDate second = today();
        String body = healthBody(estimate(first, 1, "58.4"), estimate(second, 1, "199.87"));
        jdbc.execute(
                "CREATE OR REPLACE FUNCTION test_fail_health_insert() RETURNS trigger AS $$"
                        + " BEGIN IF NEW.rhr_bpm = 199.87 THEN"
                        + " RAISE EXCEPTION 'synthetic failure %', NEW.rhr_bpm; END IF;"
                        + " RETURN NEW; END $$ LANGUAGE plpgsql");
        jdbc.execute(
                "CREATE TRIGGER test_fail_health BEFORE INSERT ON daily_health_metrics"
                        + " FOR EACH ROW EXECUTE FUNCTION test_fail_health_insert()");
        try {
            String response =
                    mockMvc.perform(healthRequest(userId, body))
                            .andExpect(status().isInternalServerError())
                            .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                            .andReturn()
                            .getResponse()
                            .getContentAsString();
            assertThat(healthRows()).isZero();
            assertThat(events.committed).isEmpty();
            assertThat(response).doesNotContain("199.87", "58.4", "synthetic failure");
            assertThat(output.getAll())
                    .contains("W06 DB 처리 실패")
                    .doesNotContain("199.87", "Failing row", "synthetic failure");
        } finally {
            jdbc.execute("DROP TRIGGER test_fail_health ON daily_health_metrics");
            jdbc.execute("DROP FUNCTION test_fail_health_insert()");
        }

        mockMvc.perform(healthRequest(userId, body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(2));
        assertThat(healthRows()).isEqualTo(2);
    }
}
