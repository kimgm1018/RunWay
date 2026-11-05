package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.node.ObjectNode;

/** AC-1·AC-9·AC-10·AC-13. 저장·재응답·충돌을 응답과 DB 행으로 판정한다. */
@Testcontainers
class SyncBatchIntegrationTest extends SyncBatchIntegrationSupport {

    @Test
    void 신규_batch를_원자적으로_저장하고_COMMITTED를_반환한다() throws Exception {
        long sessionId = runningSession();
        String id = newBatchId();
        String body = batch(id, watchId, sessionId, metric(1, 142), metric(2, 143.25), gps(2));

        mockMvc.perform(syncRequest(userId, body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMMITTED"))
                .andExpect(jsonPath("$.batchId").value(id))
                .andExpect(jsonPath("$.acceptedCount").value(3));

        Map<String, Object> stored =
                jdbc.queryForMap(
                        "SELECT session_id, payload_version, status::text AS status,"
                                + " committed_at IS NOT NULL AS committed FROM sync_batches"
                                + " WHERE device_id=? AND client_batch_id=?::uuid",
                        watchId,
                        id);
        assertThat(stored)
                .containsEntry("session_id", sessionId)
                .containsEntry("payload_version", "1")
                .containsEntry("status", "COMMITTED")
                .containsEntry("committed", true);
        assertThat(
                        jdbc.queryForList(
                                "SELECT heart_rate FROM running_metric_samples"
                                        + " WHERE running_session_id=? AND device_id=? ORDER BY measured_at",
                                BigDecimal.class,
                                sessionId,
                                watchId))
                .usingElementComparator(BigDecimal::compareTo)
                .containsExactly(new BigDecimal("142"), new BigDecimal("143.25"));
        Map<String, Object> point =
                jdbc.queryForMap(
                        "SELECT ST_X(position::geometry) AS lon, ST_Y(position::geometry) AS lat,"
                                + " accuracy, altitude, measured_at = TIMESTAMPTZ '2026-10-27T01:00:02Z' AS at"
                                + " FROM running_route_points WHERE running_session_id=? AND device_id=?",
                        sessionId,
                        watchId);
        assertThat((Double) point.get("lon")).isEqualTo(127.0012);
        assertThat((Double) point.get("lat")).isEqualTo(37.5034);
        assertThat((BigDecimal) point.get("accuracy")).isEqualByComparingTo("4.5");
        assertThat(point.get("altitude")).isNull();
        assertThat(point.get("at")).isEqualTo(true);
    }

    @Test
    void 미측정_값은_0이_아니라_NULL로_저장한다() throws Exception {
        long sessionId = runningSession();
        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, metric(1, null))))
                .andExpect(status().isOk());

        Map<String, Object> row =
                jdbc.queryForMap(
                        "SELECT heart_rate, speed, grade, total_distance, route_progress, is_hr_measured,"
                                + " cadence FROM running_metric_samples WHERE running_session_id=?",
                        sessionId);
        assertThat(row.get("heart_rate")).isNull();
        assertThat(row.get("speed")).isNull();
        assertThat(row.get("grade")).isNull();
        assertThat(row.get("total_distance")).isNull();
        assertThat(row.get("route_progress")).isNull();
        assertThat(row.get("is_hr_measured")).isEqualTo(false);
        assertThat((BigDecimal) row.get("cadence")).isEqualByComparingTo("172.5");
    }

    @Test
    void 같은_본문_재전송은_기존_ACK를_반환하고_원본을_다시_저장하지_않는다() throws Exception {
        long sessionId = runningSession();
        String id = newBatchId();
        String body = batch(id, watchId, sessionId, metric(1, 142), gps(1));
        mockMvc.perform(syncRequest(userId, body)).andExpect(status().isOk());
        int before = storedRows();

        // ACK 응답 유실 후 같은 ID·본문으로 다시 보낸다.
        mockMvc.perform(syncRequest(userId, body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMMITTED"))
                .andExpect(jsonPath("$.batchId").value(id))
                .andExpect(jsonPath("$.acceptedCount").value(2));

        assertThat(storedRows()).isEqualTo(before).isEqualTo(3);
    }

    @Test
    void 같은_ID의_다른_내용은_409_BATCH_HASH_CONFLICT() throws Exception {
        long sessionId = runningSession();
        String id = newBatchId();
        mockMvc.perform(syncRequest(userId, batch(id, watchId, sessionId, metric(1, 142))))
                .andExpect(status().isOk());
        int before = storedRows();

        mockMvc.perform(syncRequest(userId, batch(id, watchId, sessionId, metric(1, 150))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BATCH_HASH_CONFLICT"));
        mockMvc.perform(syncRequest(userId, batch(id, watchId, sessionId, metric(1, 142), gps(1))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BATCH_HASH_CONFLICT"));

        assertThat(storedRows()).isEqualTo(before);
    }

    @Test
    void 같은_ID를_다른_세션으로_보내면_409_BATCH_HASH_CONFLICT() throws Exception {
        long first = runningSession();
        String id = newBatchId();
        mockMvc.perform(syncRequest(userId, batch(id, watchId, first, metric(1, 142))))
                .andExpect(status().isOk());
        setStatus(first, "COMPLETED");
        long second = runningSession();

        mockMvc.perform(syncRequest(userId, batch(id, watchId, second, metric(1, 142))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BATCH_HASH_CONFLICT"));
        assertThat(count("SELECT count(*) FROM running_metric_samples WHERE running_session_id=?", second))
                .isZero();
    }

    @Test
    void 같은_ID의_대소문자만_다른_표기는_다른_내용으로_거절한다() throws Exception {
        long sessionId = runningSession();
        String id = "0000000a-0000-4000-8000-00000000000b";
        mockMvc.perform(syncRequest(userId, batch(id, watchId, sessionId, metric(1, 142))))
                .andExpect(status().isOk());

        mockMvc.perform(
                        syncRequest(
                                userId,
                                batch(id.toUpperCase(), watchId, sessionId, metric(1, 142))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BATCH_HASH_CONFLICT"));
    }

    @Test
    void 종료_확정_뒤_새_batch는_409이고_기존_batch는_ACK를_재응답한다() throws Exception {
        for (String ended : new String[] {"COMPLETED", "INTERRUPTED"}) {
            long sessionId = runningSession();
            String body = batch(newBatchId(), watchId, sessionId, metric(1, 142));
            mockMvc.perform(syncRequest(userId, body)).andExpect(status().isOk());
            setStatus(sessionId, ended);
            int before = storedRows();

            mockMvc.perform(syncRequest(userId, body))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("COMMITTED"));
            mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, metric(2, 142))))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

            assertThat(storedRows()).isEqualTo(before);
        }
    }

    @Test
    void 지원하는_다른_필드_조합도_저장한다() throws Exception {
        long sessionId = runningSession();
        ObjectNode full = metric(3, 150);
        full.set("speedMps", JSON.valueToTree(new BigDecimal("3.125")));
        full.set("gradePercent", JSON.valueToTree(new BigDecimal("-2.5")));
        full.set("totalDistanceM", JSON.valueToTree(new BigDecimal("1200.55")));
        full.set("routeProgressM", JSON.valueToTree(new BigDecimal("1199.1")));
        ObjectNode point = gps(3);
        point.set("altitudeM", JSON.valueToTree(new BigDecimal("-12.25")));

        mockMvc.perform(syncRequest(userId, batch(newBatchId(), watchId, sessionId, full, point)))
                .andExpect(status().isOk());
        assertThat(
                        (BigDecimal)
                                jdbc.queryForObject(
                                        "SELECT grade FROM running_metric_samples WHERE running_session_id=?",
                                        BigDecimal.class,
                                        sessionId))
                .isEqualByComparingTo("-2.5");
    }
}
