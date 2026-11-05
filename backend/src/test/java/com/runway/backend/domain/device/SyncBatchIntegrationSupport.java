package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.runway.backend.domain.device.service.BatchPayloadHasher;
import com.runway.backend.domain.readiness.service.ReadinessEvaluationDispatcher;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * W07 통합 테스트 공통 준비. 모든 측정값·좌표·시각은 합성 데이터이며 실제 건강·GPS 정보를 쓰지 않는다.
 *
 * <p>하위 클래스들이 Spring 컨텍스트와 공유 서버({@link SharedPostgres})의 전용 DB를 함께 쓴다.
 */
abstract class SyncBatchIntegrationSupport {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(SyncBatchIntegrationSupport.class);

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    protected static final JsonMapper JSON =
            JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();

    @Autowired protected MockMvc mockMvc;
    @Autowired protected JdbcTemplate jdbc;

    protected long userId;
    protected long otherUserId;
    protected long watchId;
    protected long phoneId;
    protected long otherWatchId;
    private int seq;

    @Autowired private ReadinessEvaluationDispatcher readinessDispatcher;

    /** 다른 컨텍스트의 테스트가 같은 DB를 쓰므로, 이 테스트가 남긴 평가도 끝내고 넘긴다. */
    @AfterEach
    void awaitReadinessEvaluations() throws InterruptedException {
        assertThat(readinessDispatcher.awaitIdle(Duration.ofSeconds(30))).isTrue();
    }

    @BeforeEach
    void resetData() throws InterruptedException {
        // W06 커밋 후 준비도 평가(254)는 별도 스레드에서 돈다. 앞 테스트의 평가가 끝난 뒤 지워야 회원 삭제와 겹치지 않는다.
        assertThat(readinessDispatcher.awaitIdle(Duration.ofSeconds(30))).isTrue();
        jdbc.update("DELETE FROM running_metric_samples");
        jdbc.update("DELETE FROM running_route_points");
        jdbc.update("DELETE FROM sync_batches");
        jdbc.update("DELETE FROM session_control_events");
        // W07 저장 뒤 코칭 발행(257)이 남긴 추천. 세션 FK가 있으므로 세션보다 먼저 지운다.
        jdbc.update("DELETE FROM coaching_decisions");
        jdbc.update("DELETE FROM running_sessions");
        jdbc.update("DELETE FROM user_devices");
        jdbc.update("DELETE FROM daily_health_metrics");
        // 준비도 자동 평가(254)가 남긴 결과. 회원 FK가 있으므로 회원보다 먼저 지운다.
        jdbc.update("DELETE FROM daily_readiness");
        jdbc.update("DELETE FROM users");
        userId = insertUser("AGREEE");
        otherUserId = insertUser("AGREEE");
        watchId = insertDevice(userId, "WATCH", false);
        phoneId = insertDevice(userId, "PHONE", false);
        otherWatchId = insertDevice(otherUserId, "WATCH", false);
    }

    protected long insertUser(String healthDataAccess) {
        int n = seq++;
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?,'hash',?,'2000-01-01','MALE','01011112222',?::users_health_data_access_enum)
                RETURNING id
                """,
                Long.class,
                "sync_user" + n,
                "동기화" + n,
                healthDataAccess);
    }

    protected long insertDevice(long owner, String type, boolean unlinked) {
        return jdbc.queryForObject(
                "INSERT INTO user_devices(user_id,device_type,linked_at,unlinked_at)"
                        + " VALUES (?,?::user_devices_device_type_enum,now(),"
                        + (unlinked ? "now()" : "NULL")
                        + ") RETURNING id",
                Long.class,
                owner,
                type);
    }

    protected long insertSession(long owner, String status, long version, Long control, Long relay) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id,status,state_version,control_device_id,relay_device_id,started_at)
                VALUES (?,?::running_sessions_status_enum,?,?,?,
                        CASE WHEN ?::text IN ('RUNNING','PAUSED','COMPLETED') THEN now() END)
                RETURNING id
                """,
                Long.class,
                owner,
                status,
                version,
                control,
                relay,
                status);
    }

    protected long runningSession() {
        return insertSession(userId, "RUNNING", 2, watchId, phoneId);
    }

    protected void insertCommand(long sessionId, long deviceId, String action, long version, String result) {
        jdbc.update(
                """
                INSERT INTO session_control_events(session_id,device_id,action,target_bpm,expected_version,result,applied_at)
                VALUES (?,?,?::session_control_events_action_enum,CASE WHEN ?::text = 'SET_BPM' THEN 160 END,?,
                        ?::session_control_events_result_enum,CASE WHEN ?::text = 'APPLIED' THEN now() END)
                """,
                sessionId,
                deviceId,
                action,
                action,
                version,
                result,
                result);
    }

    protected void setStatus(long sessionId, String status) {
        jdbc.update(
                "UPDATE running_sessions SET status=?::running_sessions_status_enum,"
                        + " ended_at = CASE WHEN ?::text = 'COMPLETED' THEN now() END WHERE id=?",
                status,
                status,
                sessionId);
    }

    /** 합성 심박 샘플. 심박이 있으면 isHrMeasured=true. */
    protected static ObjectNode metric(int second, Object heartRate) {
        ObjectNode item = JSON.createObjectNode();
        item.put("type", "METRIC_SAMPLE");
        item.put("measuredAt", String.format("2026-10-27T01:00:%02dZ", second));
        item.put("elapsedDurationSec", second);
        item.set("heartRateBpm", JSON.valueToTree(heartRate));
        item.set("cadenceSpm", JSON.valueToTree(new java.math.BigDecimal("172.5")));
        item.putNull("speedMps");
        item.putNull("gradePercent");
        item.putNull("totalDistanceM");
        item.putNull("routeProgressM");
        item.put("isHrMeasured", heartRate != null);
        return item;
    }

    /** 합성 GPS 점(서울 근처 임의 좌표). */
    protected static ObjectNode gps(int second) {
        ObjectNode item = JSON.createObjectNode();
        item.put("type", "GPS_POINT");
        item.put("measuredAt", String.format("2026-10-27T01:00:%02dZ", second));
        item.set("coordinates", JSON.createArrayNode().add(127.0012).add(37.5034));
        item.set("accuracyM", JSON.valueToTree(new java.math.BigDecimal("4.5")));
        item.putNull("altitudeM");
        return item;
    }

    protected static String newBatchId() {
        return UUID.randomUUID().toString();
    }

    /** payloadHash 없는 본문. */
    protected static ObjectNode body(String id, long device, long session, ObjectNode... items) {
        ObjectNode body = JSON.createObjectNode();
        body.put("id", id);
        body.put("deviceId", device);
        body.put("sessionId", session);
        body.put("schemaVersion", "1");
        var array = body.putArray("items");
        for (ObjectNode item : items) {
            array.add(item);
        }
        return body;
    }

    /** 원문을 서버와 같은 방식으로 다시 읽어 해시를 넣는다. */
    protected static String signed(ObjectNode body) {
        JsonNode reread = JSON.readTree(JSON.writeValueAsString(body));
        String hash =
                BatchPayloadHasher.hash(
                        reread, body.get("deviceId").longValue(), body.get("sessionId").longValue());
        body.put("payloadHash", hash);
        return JSON.writeValueAsString(body);
    }

    protected static String batch(String id, long device, long session, ObjectNode... items) {
        return signed(body(id, device, session, items));
    }

    protected MockHttpServletRequestBuilder syncRequest(long user, String body) {
        return post("/api/v1/sync/batches")
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    protected int count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    /** 세 저장 테이블의 전체 행 수. */
    protected int storedRows() {
        return count(
                "SELECT (SELECT count(*) FROM sync_batches) + (SELECT count(*) FROM running_metric_samples)"
                        + " + (SELECT count(*) FROM running_route_points)");
    }
}
