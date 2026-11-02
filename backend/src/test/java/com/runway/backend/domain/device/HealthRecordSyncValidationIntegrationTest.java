package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.node.ObjectNode;

/** W06 AC-2. 레코드 위반은 해당 항목만, 구문·최상위 위반은 요청 전체를 거절하고 아무것도 저장하지 않는다. */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class HealthRecordSyncValidationIntegrationTest extends HealthRecordSyncIntegrationSupport {

    private static Arguments violation(
            String name, Consumer<ObjectNode> mutate, String code, String field, String reason) {
        return Arguments.of(name, mutate, code, field, reason);
    }

    static Stream<Arguments> recordViolations() {
        return Stream.of(
                violation("type 미지원", r -> r.put("type", "SLEEP"), "UNSUPPORTED_RECORD_TYPE", "type", "UNSUPPORTED"),
                violation("type 숫자", r -> r.put("type", 1), "UNSUPPORTED_RECORD_TYPE", "type", "UNSUPPORTED"),
                violation("method 미지원", r -> r.put("method", "DAILY_V1"), "UNSUPPORTED_RECORD_TYPE", "method", "UNSUPPORTED"),
                violation("필드 누락", r -> r.remove("computedAt"), "INVALID_RECORD", "computedAt", "REQUIRED"),
                violation("추가 필드", r -> r.put("deviceId", 1), "INVALID_RECORD", null, "UNKNOWN_FIELD"),
                violation("metricDate 형식", r -> r.put("metricDate", "2026/10/30"), "INVALID_RECORD", "metricDate", "INVALID_FORMAT"),
                violation("metricDate 없는 날짜", r -> r.put("metricDate", "2026-02-30"), "INVALID_RECORD", "metricDate", "INVALID_FORMAT"),
                violation("metricDate 9일 전", r -> r.put("metricDate", today().minusDays(9).toString()), "INVALID_RECORD", "metricDate", "OUT_OF_RANGE"),
                violation("metricDate 2일 뒤", r -> r.put("metricDate", today().plusDays(2).toString()), "INVALID_RECORD", "metricDate", "OUT_OF_RANGE"),
                violation("revision 0", r -> r.put("revision", 0), "INVALID_RECORD", "revision", "OUT_OF_RANGE"),
                violation("revision int 초과", r -> r.put("revision", 2147483648L), "INVALID_RECORD", "revision", "OUT_OF_RANGE"),
                violation("revision 소수", r -> r.put("revision", new BigDecimal("1.5")), "INVALID_RECORD", "revision", "INVALID_TYPE"),
                violation("revision 문자열", r -> r.put("revision", "3"), "INVALID_RECORD", "revision", "INVALID_TYPE"),
                violation("bpm null", r -> r.putNull("estimatedRestingHrBpm"), "INVALID_RECORD", "estimatedRestingHrBpm", "INVALID_TYPE"),
                violation("bpm 29.99", r -> r.put("estimatedRestingHrBpm", new BigDecimal("29.99")), "INVALID_RECORD", "estimatedRestingHrBpm", "OUT_OF_RANGE"),
                violation("bpm 220.01", r -> r.put("estimatedRestingHrBpm", new BigDecimal("220.01")), "INVALID_RECORD", "estimatedRestingHrBpm", "OUT_OF_RANGE"),
                violation("bpm 소수 3자리", r -> r.put("estimatedRestingHrBpm", new BigDecimal("58.123")), "INVALID_RECORD", "estimatedRestingHrBpm", "TOO_MANY_DECIMALS"),
                violation("validSampleCount 0", r -> r.put("validSampleCount", 0), "INVALID_RECORD", "validSampleCount", "OUT_OF_RANGE"),
                violation("validSampleCount 1441", r -> r.put("validSampleCount", 1441), "INVALID_RECORD", "validSampleCount", "OUT_OF_RANGE"),
                violation("computedAt 시간대 오프셋", r -> r.put("computedAt", "2026-10-30T09:00:00+09:00"), "INVALID_RECORD", "computedAt", "INVALID_FORMAT"),
                violation("metricDate 숫자", r -> r.put("metricDate", 20261030), "INVALID_RECORD", "metricDate", "INVALID_FORMAT"),
                violation("bpm 문자열", r -> r.put("estimatedRestingHrBpm", "58.4"), "INVALID_RECORD", "estimatedRestingHrBpm", "INVALID_TYPE"),
                violation("validSampleCount 문자열", r -> r.put("validSampleCount", "812"), "INVALID_RECORD", "validSampleCount", "INVALID_TYPE"),
                violation("computedAt 숫자", r -> r.put("computedAt", 1), "INVALID_RECORD", "computedAt", "INVALID_FORMAT"),
                violation("method null", r -> r.putNull("method"), "UNSUPPORTED_RECORD_TYPE", "method", "UNSUPPORTED"),
                violation("computedAt 없는 날짜", r -> r.put("computedAt", "2026-02-30T09:00:00Z"), "INVALID_RECORD", "computedAt", "INVALID_FORMAT"));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("recordViolations")
    void 레코드_위반은_그_항목만_거절하고_저장하지_않는다(
            String name, Consumer<ObjectNode> mutate, String code, String field, String reason)
            throws Exception {
        ObjectNode record = estimate(today(), 1, "58.4");
        mutate.accept(record);

        var result =
                mockMvc.perform(healthRequest(userId, healthBody(record)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.acceptedCount").value(0))
                        .andExpect(jsonPath("$.duplicateCount").value(0))
                        .andExpect(jsonPath("$.rejectedCount").value(1))
                        .andExpect(jsonPath("$.errors[0].index").value(0))
                        .andExpect(jsonPath("$.errors[0].code").value(code))
                        .andExpect(jsonPath("$.errors[0].reason").value(reason));
        if (field == null) {
            result.andExpect(jsonPath("$.errors[0].field").isEmpty());
        } else {
            result.andExpect(jsonPath("$.errors[0].field").value(field));
        }
        assertThat(healthRows()).isZero();
    }

    @Test
    void 레코드_오류에_값_원문을_넣지_않는다() throws Exception {
        ObjectNode record = estimate(today(), 1, "58.4");
        record.put("estimatedRestingHrBpm", new BigDecimal("219.987"));

        String response =
                mockMvc.perform(healthRequest(userId, healthBody(record)))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        assertThat(response).doesNotContain("219.987");
    }

    static Stream<Arguments> invalidShapes() {
        return Stream.of(
                Arguments.of("JSON 구문", "{\"provider\":\"RUNWAY_WATCH\",\"records\":["),
                Arguments.of("JSON 배열", "[]"),
                Arguments.of("중복 키(최상위)", validBody().replaceFirst("\\{", "{\"provider\":\"RUNWAY_WATCH\",")),
                Arguments.of("중복 키(레코드)", validBody().replace("\"type\":", "\"revision\":1,\"type\":")),
                Arguments.of("지수 초과", validBody().replace("58.4", "1e2147483648")),
                Arguments.of("음의 지수 초과", validBody().replace("58.4", "58.4e-2147483648")),
                Arguments.of("provider 누락", "{\"records\":[]}"),
                Arguments.of("provider 숫자", "{\"provider\":1,\"records\":[{}]}"),
                Arguments.of("records 누락", "{\"provider\":\"RUNWAY_WATCH\"}"),
                Arguments.of("records 객체", "{\"provider\":\"RUNWAY_WATCH\",\"records\":{}}"),
                Arguments.of("records 비었음", "{\"provider\":\"RUNWAY_WATCH\",\"records\":[]}"),
                Arguments.of("records 원소가 객체 아님", "{\"provider\":\"RUNWAY_WATCH\",\"records\":[1]}"),
                Arguments.of("최상위 추가 필드", "{\"provider\":\"RUNWAY_WATCH\",\"records\":[{}],\"deviceId\":1}"),
                Arguments.of("NaN", "{\"provider\":\"RUNWAY_WATCH\",\"records\":[{\"estimatedRestingHrBpm\":NaN}]}"));
    }

    /** 레코드 하나가 있는 유효한 본문(문자열 치환으로 구문 위반을 만들 때 쓴다). */
    private static String validBody() {
        return healthBody(estimate(today(), 1, "58.4"));
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void 지수가_한계를_넘는_숫자는_400이고_입력값을_로그에_남기지_않는다(CapturedOutput output) throws Exception {
        String body = validBody().replace("58.4", "1e2147483648");

        String response =
                mockMvc.perform(healthRequest(userId, body))
                        .andExpect(status().isBadRequest())
                        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        assertThat(response).doesNotContain("2147483648");
        assertThat(output.getAll()).doesNotContain("2147483648");
        assertThat(healthRows()).isZero();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidShapes")
    void 구문과_최상위_형태_위반은_400으로_전체_거절한다(String name, String body) throws Exception {
        mockMvc.perform(healthRequest(userId, body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(healthRows()).isZero();
    }

    @Test
    void 본문이_32KiB를_넘으면_413이고_저장하지_않는다() throws Exception {
        String valid = validBody();
        String padded = valid.substring(0, valid.length() - 1) + " ".repeat(32 * 1024 - valid.length() + 1) + "}";
        assertThat(padded.getBytes(java.nio.charset.StandardCharsets.UTF_8)).hasSize(32 * 1024 + 1);

        mockMvc.perform(healthRequest(userId, padded))
                .andExpect(status().isContentTooLarge())
                .andExpect(jsonPath("$.code").value("FILE_TOO_LARGE"));
        assertThat(healthRows()).isZero();

        String exact = padded.substring(0, padded.length() - 2) + "}";
        mockMvc.perform(healthRequest(userId, exact)).andExpect(status().isOk());
    }

    @Test
    void records가_31개를_넘으면_400으로_전체_거절한다() throws Exception {
        ObjectNode[] records = new ObjectNode[32];
        for (int i = 0; i < records.length; i++) {
            records[i] = estimate(today(), i + 1, "58.4");
        }

        mockMvc.perform(healthRequest(userId, healthBody(records)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(healthRows()).isZero();
    }

    @Test
    void records_31개는_받는다() throws Exception {
        ObjectNode[] records = new ObjectNode[31];
        for (int i = 0; i < records.length; i++) {
            records[i] = estimate(today(), i + 1, "58.4");
        }

        mockMvc.perform(healthRequest(userId, healthBody(records)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(31));
        assertThat(metricRows(userId, today()).get(0)).containsEntry("rhr_revision", 31);
    }

    @ParameterizedTest
    @ValueSource(strings = {"SAMSUNG", "runway_watch", ""})
    void 지원하지_않는_provider는_422로_전체_거절한다(String provider) throws Exception {
        String body =
                healthBody(estimate(today(), 1, "58.4"))
                        .replace("\"RUNWAY_WATCH\"", "\"" + provider + "\"");

        mockMvc.perform(healthRequest(userId, body))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_RECORD_TYPE"))
                .andExpect(jsonPath("$.details.fields[0].name").value("provider"));
        assertThat(healthRows()).isZero();
    }

    @Test
    void 경계값은_모두_저장한다() throws Exception {
        mockMvc.perform(
                        healthRequest(
                                userId,
                                healthBody(
                                        estimate(today().minusDays(8), 1, "30"),
                                        estimate(today().plusDays(1), 1, "220"),
                                        estimate(today(), 1, "58.25"),
                                        boundaryCounts(estimate(today().minusDays(1), 2147483647, "58.40")))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.acceptedCount").value(4))
                .andExpect(jsonPath("$.rejectedCount").value(0));

        assertThat((BigDecimal) metricRows(userId, today().minusDays(8)).get(0).get("rhr_bpm"))
                .isEqualByComparingTo("30");
        assertThat((BigDecimal) metricRows(userId, today().plusDays(1)).get(0).get("rhr_bpm"))
                .isEqualByComparingTo("220");
        assertThat((BigDecimal) metricRows(userId, today()).get(0).get("rhr_bpm"))
                .isEqualByComparingTo("58.25");
        assertThat(metricRows(userId, today().minusDays(1)).get(0))
                .containsEntry("rhr_revision", 2147483647);
    }

    private static ObjectNode boundaryCounts(ObjectNode record) {
        record.put("validSampleCount", 1440);
        record.put("computedAt", "2026-10-30T23:59:59.123456789Z");
        return record;
    }
}
