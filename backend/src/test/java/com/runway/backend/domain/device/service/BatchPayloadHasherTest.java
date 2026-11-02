package com.runway.backend.domain.device.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.device.dto.request.SyncBatchRequest;
import com.runway.backend.global.exception.ApiException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** AC-3. 합성 본문만 사용한다. */
class BatchPayloadHasherTest {

    /** devices-health.md W07 "합성 요청 예시"의 본문과 해시. */
    private static final String SPEC_EXAMPLE =
            """
            {
              "id": "00000000-0000-4000-8000-000000000101",
              "deviceId": 101,
              "sessionId": 5001,
              "schemaVersion": "1",
              "items": [
                {
                  "type": "METRIC_SAMPLE",
                  "measuredAt": "2026-10-27T01:00:01Z",
                  "elapsedDurationSec": 1,
                  "heartRateBpm": 142,
                  "cadenceSpm": null,
                  "speedMps": null,
                  "gradePercent": null,
                  "totalDistanceM": null,
                  "routeProgressM": null,
                  "isHrMeasured": true
                }
              ],
              "payloadHash": "ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c"
            }
            """;

    private static SyncBatchRequest parse(String json) {
        return SyncBatchRequest.parse(json.getBytes(StandardCharsets.UTF_8));
    }

    private static String hashOf(String json) {
        SyncBatchRequest request = parse(json);
        return BatchPayloadHasher.hash(request.body(), request.deviceId(), request.sessionId());
    }

    @Test
    void 명세_예시의_해시를_재현한다() {
        assertThat(BatchPayloadHasher.verify(parse(SPEC_EXAMPLE)))
                .isEqualTo("ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c");
    }

    /**
     * 서버 코드와 독립된 기준값. 소수 측정값·음수·GPS·마이크로초·2^53을 넘는 ID를 포함한 본문을 Python 표준 json(정렬 키, 구분자 공백 없음, 이 값들은
     * ES6 숫자 표기와 같다)으로 정규화해 SHA-256을 계산했다(2026-11-02). 앱의 JCS 구현과 어긋나는지 확인하는 기준이다.
     */
    @Test
    void 소수_GPS_큰ID를_포함한_독립_기준값을_재현한다() {
        String body =
                """
                {"id":"1f0e3b9a-7c2d-4e5f-9a8b-0c1d2e3f4a5b","deviceId":9007199254740993,"sessionId":42,
                 "schemaVersion":"1","payloadHash":"dd0deda5d9ea24f47200c1c0f19c75f6410c41b437cb73ca615dbf77c82b5b7c",
                 "items":[
                  {"type":"METRIC_SAMPLE","measuredAt":"2026-10-27T01:00:01.123456Z","elapsedDurationSec":61,
                   "heartRateBpm":143.25,"cadenceSpm":172.50,"speedMps":3.125,"gradePercent":-2.5,
                   "totalDistanceM":1200.55,"routeProgressM":null,"isHrMeasured":true},
                  {"type":"GPS_POINT","measuredAt":"2026-10-27T01:00:02Z","coordinates":[127.0012,37.5034],
                   "accuracyM":4.5,"altitudeM":-12.25}]}
                """;
        assertThat(BatchPayloadHasher.verify(parse(body)))
                .isEqualTo("dd0deda5d9ea24f47200c1c0f19c75f6410c41b437cb73ca615dbf77c82b5b7c");
    }

    @Test
    void 키_순서와_공백이_달라도_같은_해시다() {
        String reordered =
                "{\"payloadHash\":\"ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c\","
                        + "\"items\":[{\"isHrMeasured\":true,\"routeProgressM\":null,\"totalDistanceM\":null,"
                        + "\"gradePercent\":null,\"speedMps\":null,\"cadenceSpm\":null,\"heartRateBpm\":142,"
                        + "\"elapsedDurationSec\":1,\"measuredAt\":\"2026-10-27T01:00:01Z\",\"type\":\"METRIC_SAMPLE\"}],"
                        + "\"schemaVersion\":\"1\",\"sessionId\":5001,\"deviceId\":101,"
                        + "\"id\":\"00000000-0000-4000-8000-000000000101\"}";
        assertThat(hashOf(reordered)).isEqualTo(hashOf(SPEC_EXAMPLE));
    }

    @Test
    void 같은_수의_다른_표기는_JCS로_같은_해시다() {
        assertThat(hashOf(SPEC_EXAMPLE.replace("\"heartRateBpm\": 142", "\"heartRateBpm\": 142.00")))
                .isEqualTo(hashOf(SPEC_EXAMPLE));
    }

    @Test
    void 값_id_대소문자_null_배열순서가_바뀌면_해시가_달라진다() {
        String base = hashOf(SPEC_EXAMPLE);
        assertThat(hashOf(SPEC_EXAMPLE.replace("142", "143"))).isNotEqualTo(base);
        assertThat(
                        hashOf(
                                SPEC_EXAMPLE.replace(
                                        "00000000-0000-4000-8000-000000000101",
                                        "00000000-0000-4000-8000-00000000010A")))
                .isNotEqualTo(
                        hashOf(
                                SPEC_EXAMPLE.replace(
                                        "00000000-0000-4000-8000-000000000101",
                                        "00000000-0000-4000-8000-00000000010a")));
        assertThat(hashOf(SPEC_EXAMPLE.replace("\"cadenceSpm\": null", "\"cadenceSpm\": 170")))
                .isNotEqualTo(base);

        String first = "{\"type\":\"GPS_POINT\",\"measuredAt\":\"2026-10-27T01:00:01Z\","
                + "\"coordinates\":[127.1,37.5],\"accuracyM\":null,\"altitudeM\":null}";
        String second = first.replace("01:00:01Z", "01:00:02Z");
        String head = "{\"id\":\"00000000-0000-4000-8000-000000000101\",\"deviceId\":101,\"sessionId\":5001,"
                + "\"schemaVersion\":\"1\",\"payloadHash\":\"" + "0".repeat(64) + "\",\"items\":[";
        assertThat(hashOf(head + first + "," + second + "]}"))
                .isNotEqualTo(hashOf(head + second + "," + first + "]}"));
    }

    @Test
    void 큰_ID는_반올림없이_십진_문자열로_해시한다() {
        String big = SPEC_EXAMPLE.replace("\"deviceId\": 101", "\"deviceId\": 9007199254740993");
        String neighbor = SPEC_EXAMPLE.replace("\"deviceId\": 101", "\"deviceId\": 9007199254740992");
        assertThat(hashOf(big)).isNotEqualTo(hashOf(neighbor));
    }

    @Test
    void 해시가_다르면_422_INVALID_BATCH() {
        String tampered =
                SPEC_EXAMPLE.replace(
                        "ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c",
                        "ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4d");
        assertThatThrownBy(() -> BatchPayloadHasher.verify(parse(tampered)))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.code()).isEqualTo("INVALID_BATCH"));
    }
}
