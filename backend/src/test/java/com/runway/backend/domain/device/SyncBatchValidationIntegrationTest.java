package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import java.math.BigDecimal;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.node.ObjectNode;

/** AC-2·AC-3·AC-4·AC-16·AC-17. 거절된 요청은 어떤 행도 남기지 않고, 오류 응답에 측정값·좌표·해시를 담지 않는다. */
@Testcontainers
class SyncBatchValidationIntegrationTest extends SyncBatchIntegrationSupport {

    private static final String SAMPLE_HR = "142.77";
    /** 지원하지 않는 키 이름. 오류 details에 되돌아오지 않아야 한다. */
    private static final String UNKNOWN_KEY = "unexpectedClientKey";

    /** 정상 본문 하나를 만들어 변형한다. sessionId·deviceId는 실행 시 채운다. */
    private ObjectNode validBody(long sessionId) {
        ObjectNode metric = metric(1, new BigDecimal(SAMPLE_HR));
        return body(newBatchId(), watchId, sessionId, metric, gps(1));
    }

    private void expectRejected(String body, int status, String code) throws Exception {
        MvcResult result =
                mockMvc.perform(syncRequest(userId, body))
                        .andExpect(status().is(status))
                        .andExpect(jsonPath("$.code").value(code))
                        .andReturn();
        String response = result.getResponse().getContentAsString();
        assertThat(response).doesNotContain(SAMPLE_HR, "127.0012", "37.5034", UNKNOWN_KEY);
        // 오류 응답에 해시 원문(64자리 hex)을 담지 않는다.
        assertThat(response).doesNotContainPattern("[0-9a-f]{64}");
        assertThat(storedRows()).isZero();
    }

    static Stream<Arguments> malformed() {
        return Stream.of(
                Arguments.of("JSON 구문 오류", (Consumer<ObjectNode>) b -> {}, "{\"id\":"),
                Arguments.of("중복 키", null, "DUPLICATE"),
                Arguments.of("NaN", null, "NAN"),
                Arguments.of("배열 본문", null, "[]"),
                Arguments.of("id 누락", (Consumer<ObjectNode>) b -> b.remove("id"), null),
                Arguments.of("id UUID v1", (Consumer<ObjectNode>) b -> b.put("id", "00000000-0000-1000-8000-000000000001"), null),
                Arguments.of("id 숫자", (Consumer<ObjectNode>) b -> b.put("id", 1), null),
                Arguments.of("deviceId 문자열", (Consumer<ObjectNode>) b -> b.put("deviceId", "1"), null),
                Arguments.of("deviceId 0", (Consumer<ObjectNode>) b -> b.put("deviceId", 0), null),
                Arguments.of("sessionId 음수", (Consumer<ObjectNode>) b -> b.put("sessionId", -1), null),
                Arguments.of("sessionId 소수", (Consumer<ObjectNode>) b -> b.put("sessionId", new BigDecimal("1.5")), null),
                Arguments.of("sessionId int64 초과", (Consumer<ObjectNode>) b -> b.put("sessionId", new java.math.BigInteger("9223372036854775808")), null),
                Arguments.of("schemaVersion 숫자", (Consumer<ObjectNode>) b -> b.put("schemaVersion", 1), null),
                Arguments.of("payloadHash 대문자", (Consumer<ObjectNode>) b -> b.put("payloadHash", "A".repeat(64)), null),
                Arguments.of("payloadHash 길이", (Consumer<ObjectNode>) b -> b.put("payloadHash", "a".repeat(63)), null),
                Arguments.of("items 누락", (Consumer<ObjectNode>) b -> b.remove("items"), null),
                Arguments.of("items 객체", (Consumer<ObjectNode>) b -> b.putObject("items"), null));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("malformed")
    void 구문_필수_자료형_ID범위_오류는_400(String name, Consumer<ObjectNode> change, String raw)
            throws Exception {
        long sessionId = runningSession();
        String body;
        if (raw == null) {
            ObjectNode b = validBody(sessionId);
            String signed = signed(b);
            ObjectNode resigned = (ObjectNode) JSON.readTree(signed);
            change.accept(resigned);
            body = JSON.writeValueAsString(resigned);
        } else if (raw.equals("DUPLICATE")) {
            String signed = signed(validBody(sessionId));
            body = signed.replaceFirst("\\{", "{\"schemaVersion\":\"1\",");
        } else if (raw.equals("NAN")) {
            body = signed(validBody(sessionId)).replace(SAMPLE_HR, "NaN");
        } else {
            body = raw;
        }
        expectRejected(body, 400, "VALIDATION_ERROR");
    }

    static Stream<Arguments> invalidBatch() {
        return Stream.of(
                Arguments.of("빈 items", (Consumer<ObjectNode>) b -> b.putArray("items")),
                Arguments.of("지원하지 않는 버전", (Consumer<ObjectNode>) b -> b.put("schemaVersion", "2")),
                Arguments.of("최상위 추가 필드", (Consumer<ObjectNode>) b -> b.put(UNKNOWN_KEY, "watch")),
                Arguments.of("type 누락", (Consumer<ObjectNode>) b -> metricOf(b).remove("type")),
                Arguments.of("경사 소수 4자리", (Consumer<ObjectNode>) b -> metricOf(b).put("gradePercent", new BigDecimal("1.2345"))),
                Arguments.of("경사 정수부 초과", (Consumer<ObjectNode>) b -> metricOf(b).put("gradePercent", new BigDecimal("10000"))),
                Arguments.of("케이던스 정수부 초과", (Consumer<ObjectNode>) b -> metricOf(b).put("cadenceSpm", new BigDecimal("1000000"))),
                Arguments.of("속도 소수 4자리", (Consumer<ObjectNode>) b -> metricOf(b).put("speedMps", new BigDecimal("3.1234"))),
                Arguments.of("정확도 소수 3자리", (Consumer<ObjectNode>) b -> gpsOf(b).put("accuracyM", new BigDecimal("4.125"))),
                Arguments.of("고도 소수 3자리", (Consumer<ObjectNode>) b -> gpsOf(b).put("altitudeM", new BigDecimal("12.125"))),
                Arguments.of("measuredAt 24시", (Consumer<ObjectNode>) b -> metricOf(b).put("measuredAt", "2026-10-27T24:00:00Z")),
                Arguments.of("measuredAt 윤초", (Consumer<ObjectNode>) b -> metricOf(b).put("measuredAt", "2026-12-31T23:59:60Z")),
                Arguments.of("지원하지 않는 타입", (Consumer<ObjectNode>) b -> metricOf(b).put("type", "IBI")),
                Arguments.of("항목 추가 필드", (Consumer<ObjectNode>) b -> metricOf(b).put(UNKNOWN_KEY, "HIGH")),
                Arguments.of("항목 키 누락", (Consumer<ObjectNode>) b -> metricOf(b).remove("speedMps")),
                Arguments.of("항목이 객체가 아님", (Consumer<ObjectNode>) b -> ((tools.jackson.databind.node.ArrayNode) b.get("items")).add(1)),
                Arguments.of("음수 경과시간", (Consumer<ObjectNode>) b -> metricOf(b).put("elapsedDurationSec", -1)),
                Arguments.of("소수 경과시간", (Consumer<ObjectNode>) b -> metricOf(b).put("elapsedDurationSec", new BigDecimal("1.5"))),
                Arguments.of("심박 0", (Consumer<ObjectNode>) b -> metricOf(b).put("heartRateBpm", 0)),
                Arguments.of("심박 문자열", (Consumer<ObjectNode>) b -> metricOf(b).put("heartRateBpm", "142")),
                Arguments.of("심박 소수 3자리", (Consumer<ObjectNode>) b -> metricOf(b).put("heartRateBpm", new BigDecimal("142.125"))),
                Arguments.of("심박 정수부 초과", (Consumer<ObjectNode>) b -> metricOf(b).put("heartRateBpm", new BigDecimal("100000"))),
                Arguments.of("속도 음수", (Consumer<ObjectNode>) b -> metricOf(b).put("speedMps", new BigDecimal("-0.1"))),
                Arguments.of("거리 음수", (Consumer<ObjectNode>) b -> metricOf(b).put("totalDistanceM", new BigDecimal("-1"))),
                Arguments.of("isHrMeasured=true인데 심박 null", (Consumer<ObjectNode>) b -> metricOf(b).putNull("heartRateBpm")),
                Arguments.of("isHrMeasured=false인데 심박 있음", (Consumer<ObjectNode>) b -> metricOf(b).put("isHrMeasured", false)),
                Arguments.of("측정값 전부 null", (Consumer<ObjectNode>) b -> metricOf(b).putNull("heartRateBpm").put("isHrMeasured", false).putNull("cadenceSpm")),
                Arguments.of("measuredAt 오프셋", (Consumer<ObjectNode>) b -> metricOf(b).put("measuredAt", "2026-10-27T10:00:01+09:00")),
                Arguments.of("measuredAt 나노초", (Consumer<ObjectNode>) b -> metricOf(b).put("measuredAt", "2026-10-27T01:00:01.1234567Z")),
                Arguments.of("measuredAt 없는 날짜", (Consumer<ObjectNode>) b -> metricOf(b).put("measuredAt", "2026-02-30T01:00:01Z")),
                Arguments.of("경도 범위", (Consumer<ObjectNode>) b -> gpsOf(b).set("coordinates", JSON.createArrayNode().add(180.5).add(37.5))),
                Arguments.of("위도 범위", (Consumer<ObjectNode>) b -> gpsOf(b).set("coordinates", JSON.createArrayNode().add(127.0).add(-90.1))),
                Arguments.of("좌표 3개", (Consumer<ObjectNode>) b -> gpsOf(b).set("coordinates", JSON.createArrayNode().add(127.0).add(37.5).add(1))),
                Arguments.of("정확도 음수", (Consumer<ObjectNode>) b -> gpsOf(b).put("accuracyM", -1)));
    }

    private static ObjectNode metricOf(ObjectNode body) {
        return (ObjectNode) body.get("items").get(0);
    }

    private static ObjectNode gpsOf(ObjectNode body) {
        return (ObjectNode) body.get("items").get(1);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidBatch")
    void 지원_범위_밖_내용은_batch_전체를_422로_거절한다(String name, Consumer<ObjectNode> change)
            throws Exception {
        long sessionId = runningSession();
        ObjectNode body = validBody(sessionId);
        change.accept(body);
        // 해시를 올바르게 다시 계산할 수 있는 경우에도 내용 위반으로 거절되는지 본다.
        String json;
        try {
            json = signed(body);
        } catch (RuntimeException notHashable) {
            body.put("payloadHash", "0".repeat(64));
            json = JSON.writeValueAsString(body);
        }
        expectRejected(json, 422, "INVALID_BATCH");
    }

    @Test
    void 본문_해시가_다르면_422() throws Exception {
        long sessionId = runningSession();
        ObjectNode body = validBody(sessionId);
        signed(body);
        body.put("payloadHash", "0".repeat(64));
        expectRejected(JSON.writeValueAsString(body), 422, "INVALID_BATCH");
    }

    @Test
    void 서명_후_값을_바꾸면_422() throws Exception {
        long sessionId = runningSession();
        String tampered = signed(validBody(sessionId)).replace(SAMPLE_HR, "150");
        expectRejected(tampered, 422, "INVALID_BATCH");
    }

    @Test
    void 본문이_32KiB를_넘으면_413() throws Exception {
        long sessionId = runningSession();
        ObjectNode body = validBody(sessionId);
        var items = (tools.jackson.databind.node.ArrayNode) body.get("items");
        while (JSON.writeValueAsString(body).length() <= 32 * 1024 + 200) {
            items.add(metric(items.size() % 60, 140));
        }
        String json = signed(body);
        assertThat(json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length).isGreaterThan(32 * 1024);
        expectRejected(json, 413, "FILE_TOO_LARGE");
    }

    @Test
    void 정확히_32KiB_본문은_크기_때문에_거절하지_않는다() throws Exception {
        long sessionId = runningSession();
        String json = signed(validBody(sessionId));
        int pad = 32 * 1024 - json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        String exact = json.substring(0, json.length() - 1) + " ".repeat(pad) + "}";
        assertThat(exact.getBytes(java.nio.charset.StandardCharsets.UTF_8)).hasSize(32 * 1024);
        mockMvc.perform(syncRequest(userId, exact)).andExpect(status().isOk());
    }

    @Test
    void JSON이_아닌_콘텐츠_형식은_415() throws Exception {
        long sessionId = runningSession();
        mockMvc.perform(
                        post("/api/v1/sync/batches")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.TEXT_PLAIN)
                                .content(signed(validBody(sessionId))))
                .andExpect(status().isUnsupportedMediaType());
        assertThat(storedRows()).isZero();
    }
}
