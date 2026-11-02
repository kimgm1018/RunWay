package com.runway.backend.domain.device.dto.request;

import com.runway.backend.domain.device.dto.response.HealthRecordSyncResponse.RecordError;
import com.runway.backend.domain.device.service.HealthRecordSyncErrors;
import java.math.BigDecimal;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * W06 요청(devices-health.md W06). 원문 바이트를 직접 파싱해 중복 키·NaN을 거절하고 소수를 BigDecimal 원문 그대로 읽는다.
 *
 * <p>오류 구분: JSON 구문·최상위 필드(누락·자료형·추가 필드)·records 형태(배열·1~31개·각 원소 객체)는 400 VALIDATION_ERROR로
 * 전체 거절한다. 지원하지 않는 provider는 422 UNSUPPORTED_RECORD_TYPE로 전체 거절한다. 그 밖의 레코드 안 위반은 해당 레코드만 거절하고
 * 응답 errors에 index·code·field·reason을 담는다. 오류에는 값 원문을 넣지 않는다.
 *
 * @param records 요청 순서의 레코드 판정 결과. 유효하면 {@link DailyHrEstimate}, 아니면 {@link Rejected}
 */
public record HealthRecordSyncRequest(String provider, List<ParsedRecord> records) {

    public static final String PROVIDER_RUNWAY_WATCH = "RUNWAY_WATCH";
    public static final String TYPE_DAILY_HR_ESTIMATE = "DAILY_HR_ESTIMATE";
    public static final String METHOD_ROLLING24H_V2 = "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2";

    /** 폰은 미업로드 값을 7일까지 보관한다(63번). 한 요청은 한 달 분량을 넘지 않는다. */
    public static final int MAX_RECORDS = 31;

    /** metricDate 허용 범위(D-5): 서버 UTC 오늘 −8일 ~ +1일. 폰 7일 보관과 시간대 차이(UTC−12~+14)를 감안한 값. */
    public static final int MAX_PAST_DAYS = 8;

    public static final int MAX_FUTURE_DAYS = 1;

    static final BigDecimal MIN_BPM = BigDecimal.valueOf(30);
    static final BigDecimal MAX_BPM = BigDecimal.valueOf(220);

    /** 24시간의 분 수. validSampleCount는 1분 평균 개수다. */
    static final int MAX_VALID_SAMPLE_COUNT = 1440;

    private static final Set<String> TOP_LEVEL_KEYS = Set.of("provider", "records");
    private static final List<String> RECORD_KEYS =
            List.of(
                    "type",
                    "metricDate",
                    "revision",
                    "estimatedRestingHrBpm",
                    "method",
                    "validSampleCount",
                    "computedAt");

    private static final Pattern LOCAL_DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");

    /** UTC(Z) ISO 8601. 24:00·윤초(:60)는 거절한다. */
    private static final Pattern UTC_INSTANT =
            Pattern.compile(
                    "^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d{1,9})?Z$");

    private static final JsonMapper STRICT =
            JsonMapper.builder()
                    .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
                    .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .build();

    public sealed interface ParsedRecord permits DailyHrEstimate, Rejected {}

    /** 저장 대상 추정값. validSampleCount·computedAt·method는 검증만 하고 저장하지 않는다. */
    public record DailyHrEstimate(LocalDate metricDate, int revision, BigDecimal restingHrBpm)
            implements ParsedRecord {}

    public record Rejected(RecordError error) implements ParsedRecord {}

    /** 레코드 하나의 첫 위반. 서버가 정한 필드 이름과 사유 코드만 담는다. */
    private static final class RecordViolation extends RuntimeException {
        private final String code;
        private final String field;
        private final String reason;

        RecordViolation(String code, String field, String reason) {
            super(null, null, false, false);
            this.code = code;
            this.field = field;
            this.reason = reason;
        }
    }

    /**
     * @param today 서버 UTC 기준 오늘. metricDate 범위 판정에 쓴다.
     */
    public static HealthRecordSyncRequest parse(byte[] raw, LocalDate today) {
        JsonNode body;
        try {
            body = STRICT.readTree(raw);
        } catch (JacksonException | NumberFormatException | ArithmeticException e) {
            // BigDecimal 한계를 넘는 지수(예: 1e2147483648)는 JacksonException이 아니라 NumberFormatException으로 온다.
            // 공통 처리기로 넘기면 500과 입력 원문 로그가 되므로 구문 오류와 같게 거절한다. 원인 메시지는 쓰지 않는다.
            throw HealthRecordSyncErrors.validation();
        }
        if (body == null || !body.isObject()) {
            throw HealthRecordSyncErrors.validation("body", "JSON 객체여야 합니다.");
        }
        // 지원하지 않는 키 이름은 클라이언트가 보낸 임의 문자열이므로 오류에 되돌려 보내지 않는다.
        for (String name : body.propertyNames()) {
            if (!TOP_LEVEL_KEYS.contains(name)) {
                throw HealthRecordSyncErrors.validation("body", "지원하지 않는 필드가 있습니다.");
            }
        }
        JsonNode provider = body.get("provider");
        if (provider == null || !provider.isString()) {
            throw HealthRecordSyncErrors.validation("provider", "문자열이어야 합니다.");
        }
        JsonNode recordsNode = body.get("records");
        if (recordsNode == null || !recordsNode.isArray()) {
            throw HealthRecordSyncErrors.validation("records", "배열이어야 합니다.");
        }
        if (recordsNode.isEmpty() || recordsNode.size() > MAX_RECORDS) {
            throw HealthRecordSyncErrors.validation(
                    "records", "1개 이상 " + MAX_RECORDS + "개 이하여야 합니다.");
        }
        for (int i = 0; i < recordsNode.size(); i++) {
            if (!recordsNode.get(i).isObject()) {
                throw HealthRecordSyncErrors.validation("records[" + i + "]", "객체여야 합니다.");
            }
        }
        if (!PROVIDER_RUNWAY_WATCH.equals(provider.stringValue())) {
            throw HealthRecordSyncErrors.unsupportedProvider();
        }

        LocalDate earliest = today.minusDays(MAX_PAST_DAYS);
        LocalDate latest = today.plusDays(MAX_FUTURE_DAYS);
        List<ParsedRecord> records = new ArrayList<>(recordsNode.size());
        for (int i = 0; i < recordsNode.size(); i++) {
            try {
                records.add(parseRecord(recordsNode.get(i), earliest, latest));
            } catch (RecordViolation v) {
                records.add(new Rejected(new RecordError(i, v.code, v.field, v.reason)));
            }
        }
        return new HealthRecordSyncRequest(provider.stringValue(), List.copyOf(records));
    }

    private static DailyHrEstimate parseRecord(
            JsonNode record, LocalDate earliest, LocalDate latest) {
        for (String name : record.propertyNames()) {
            if (!RECORD_KEYS.contains(name)) {
                throw invalid(null, "UNKNOWN_FIELD");
            }
        }
        for (String key : RECORD_KEYS) {
            if (!record.has(key)) {
                throw invalid(key, "REQUIRED");
            }
        }
        JsonNode type = record.get("type");
        if (!type.isString() || !TYPE_DAILY_HR_ESTIMATE.equals(type.stringValue())) {
            throw unsupported("type");
        }
        LocalDate metricDate = metricDate(record.get("metricDate"), earliest, latest);
        int revision = intIn(record.get("revision"), "revision", 1, Integer.MAX_VALUE);
        BigDecimal bpm = restingHr(record.get("estimatedRestingHrBpm"));
        JsonNode method = record.get("method");
        if (!method.isString() || !METHOD_ROLLING24H_V2.equals(method.stringValue())) {
            throw unsupported("method");
        }
        intIn(record.get("validSampleCount"), "validSampleCount", 1, MAX_VALID_SAMPLE_COUNT);
        computedAt(record.get("computedAt"));
        return new DailyHrEstimate(metricDate, revision, bpm);
    }

    private static LocalDate metricDate(JsonNode node, LocalDate earliest, LocalDate latest) {
        if (!node.isString() || !LOCAL_DATE.matcher(node.stringValue()).matches()) {
            throw invalid("metricDate", "INVALID_FORMAT");
        }
        LocalDate date;
        try {
            date = LocalDate.parse(node.stringValue());
        } catch (DateTimeException e) {
            throw invalid("metricDate", "INVALID_FORMAT");
        }
        if (date.isBefore(earliest) || date.isAfter(latest)) {
            throw invalid("metricDate", "OUT_OF_RANGE");
        }
        return date;
    }

    private static int intIn(JsonNode node, String field, int min, int max) {
        if (!node.isIntegralNumber()) {
            throw invalid(field, "INVALID_TYPE");
        }
        if (!node.canConvertToInt() || node.intValue() < min || node.intValue() > max) {
            throw invalid(field, "OUT_OF_RANGE");
        }
        return node.intValue();
    }

    /** 30~220bpm, 소수 둘째 자리까지(NUMERIC(7,2)). 반올림하지 않고 거절한다. */
    private static BigDecimal restingHr(JsonNode node) {
        String field = "estimatedRestingHrBpm";
        if (!node.isNumber()) {
            throw invalid(field, "INVALID_TYPE");
        }
        BigDecimal value;
        try {
            value = node.decimalValue();
        } catch (RuntimeException e) {
            throw invalid(field, "INVALID_TYPE");
        }
        if (value.compareTo(MIN_BPM) < 0 || value.compareTo(MAX_BPM) > 0) {
            throw invalid(field, "OUT_OF_RANGE");
        }
        if (Math.max(value.stripTrailingZeros().scale(), 0) > 2) {
            throw invalid(field, "TOO_MANY_DECIMALS");
        }
        return value;
    }

    private static void computedAt(JsonNode node) {
        if (!node.isString() || !UTC_INSTANT.matcher(node.stringValue()).matches()) {
            throw invalid("computedAt", "INVALID_FORMAT");
        }
        try {
            Instant.parse(node.stringValue());
        } catch (DateTimeException e) {
            throw invalid("computedAt", "INVALID_FORMAT");
        }
    }

    private static RecordViolation invalid(String field, String reason) {
        return new RecordViolation(HealthRecordSyncErrors.INVALID_RECORD, field, reason);
    }

    private static RecordViolation unsupported(String field) {
        return new RecordViolation(
                HealthRecordSyncErrors.UNSUPPORTED_RECORD_TYPE, field, "UNSUPPORTED");
    }
}
