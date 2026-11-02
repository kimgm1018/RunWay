package com.runway.backend.domain.device;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.runway.backend.global.security.SecurityTestSupport;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.node.ObjectNode;

/**
 * W06 통합 테스트 공통 준비. W07 준비(컨테이너·회원·기기)를 그대로 공유한다. 모든 심박 값·날짜는 합성 데이터다.
 *
 * <p>metricDate 허용 범위가 서버 UTC 오늘 기준이므로 테스트 날짜도 실행 시점의 UTC 오늘에서 계산한다.
 */
@Import(HealthEventRecorder.class)
abstract class HealthRecordSyncIntegrationSupport extends SyncBatchIntegrationSupport {

    @Autowired protected HealthEventRecorder events;

    @BeforeEach
    void clearEvents() {
        events.clear();
    }

    /** UTC 자정까지 이 시간보다 적게 남았으면 자정이 지난 뒤 시작한다. 한 테스트(반복 1회)는 이보다 짧다. */
    private static final Duration MIDNIGHT_MARGIN = Duration.ofSeconds(15);

    /**
     * 테스트와 서버가 각자 UTC 오늘을 계산하므로, 테스트 도중 날짜가 바뀌면 metricDate 범위 판정이 어긋난다. 자정 직전이면 날짜가 바뀔 때까지
     * 기다려 같은 날짜 안에서 실행한다. 기대값은 바꾸지 않는다.
     */
    @BeforeEach
    void avoidUtcMidnight() throws InterruptedException {
        Instant now = Instant.now();
        Instant nextMidnight =
                LocalDate.ofInstant(now, ZoneOffset.UTC).plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        Duration left = Duration.between(now, nextMidnight);
        if (left.compareTo(MIDNIGHT_MARGIN) < 0) {
            Thread.sleep(left.toMillis() + 100);
        }
    }

    protected static final String METHOD = "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2";

    protected static LocalDate today() {
        return LocalDate.now(ZoneOffset.UTC);
    }

    /** 유효한 합성 일상 심박 추정값 레코드. */
    protected static ObjectNode estimate(LocalDate date, int revision, String bpm) {
        ObjectNode record = JSON.createObjectNode();
        record.put("type", "DAILY_HR_ESTIMATE");
        record.put("metricDate", date.toString());
        record.put("revision", revision);
        record.set("estimatedRestingHrBpm", JSON.valueToTree(new BigDecimal(bpm)));
        record.put("method", METHOD);
        record.put("validSampleCount", 812);
        record.put("computedAt", date + "T09:00:00Z");
        return record;
    }

    protected static String healthBody(ObjectNode... records) {
        ObjectNode body = JSON.createObjectNode();
        body.put("provider", "RUNWAY_WATCH");
        var array = body.putArray("records");
        for (ObjectNode record : records) {
            array.add(record);
        }
        return JSON.writeValueAsString(body);
    }

    protected MockHttpServletRequestBuilder healthRequest(long user, String body) {
        return post("/api/v1/health-records/sync")
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    /** 회원의 날짜별 저장 행. 없으면 빈 목록. */
    protected List<Map<String, Object>> metricRows(long user, LocalDate date) {
        return jdbc.queryForList(
                "SELECT rhr_bpm, rhr_revision, sleep_duration_min, daily_training_load, max_heart_rate,"
                        + " updated_at FROM daily_health_metrics WHERE user_id=? AND metric_date=?",
                user,
                date);
    }

    protected int healthRows() {
        return count("SELECT count(*) FROM daily_health_metrics");
    }
}
