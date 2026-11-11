package com.runway.backend.domain.device.dto.request;

import com.runway.backend.domain.device.dto.response.HealthRecordSyncResponse.RecordError;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.exception.HealthRecordErrorCode;

import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * W06 요청(devices-health.md W06). 원문 바이트를 직접 파싱해 중복 키·NaN을 거절하고 소수를 BigDecimal 원문 그대로 읽는다.
 *
 * <p>오류 구분: JSON 구문·최상위 필드(누락·자료형·추가 필드)·records 형태(배열·1~31개·각 원소 객체)는 400 VALIDATION_ERROR로 전체
 * 거절한다. 지원하지 않는 provider는 422 UNSUPPORTED_RECORD_TYPE로 전체 거절한다. 그 밖의 레코드 안 위반은 해당 레코드만 거절하고 응답
 * errors에 index·code·field·reason을 담는다. 오류에는 값 원문을 넣지 않는다.
 *
 * <p>provider별 허용 type: {@code RUNWAY_WATCH} → {@code DAILY_HR_ESTIMATE}, {@code SAMSUNG_HEALTH} → {@code
 * DAILY_SLEEP_SUMMARY}(S15P31E105-572)·{@code DAILY_RESTING_HR}(S15P31E105-600)·{@code EXERCISE_HR_SUMMARY}
 * (S15P31E105-599, 한 요청에 섞을 수 있음). provider와 맞지 않는
 * type은 레코드 오류 UNSUPPORTED_RECORD_TYPE이다. {@code SAMSUNG_HEALTH}는 type이 문자열 {@code DAILY_RESTING_HR}일 때만 안정 심박
 * 형식으로, 그 밖에는 수면 형식으로 검증한다(572의 기존 판정 유지).
 *
 * @param records 요청 순서의 레코드 판정 결과. 유효하면 {@link DailyHrEstimate}·{@link DailySleepSummary}·{@link
 *     SamsungRestingHr}, 아니면 {@link Rejected}
 */
public record HealthRecordSyncRequest(String provider, List<ParsedRecord> records) {

    public static final String PROVIDER_RUNWAY_WATCH = "RUNWAY_WATCH";
    public static final String TYPE_DAILY_HR_ESTIMATE = "DAILY_HR_ESTIMATE";
    public static final String METHOD_ROLLING24H_V2 = "ROLLING24H_LOWER_10PCT_MINUTE_MEAN_V2";
    public static final String PROVIDER_SAMSUNG_HEALTH = "SAMSUNG_HEALTH";
    public static final String TYPE_DAILY_SLEEP_SUMMARY = "DAILY_SLEEP_SUMMARY";
    public static final String TYPE_DAILY_RESTING_HR = "DAILY_RESTING_HR";
    public static final String METHOD_DAILY_LOWER_10PCT_V1 = "DAILY_LOWER_10PCT_MINUTE_MEAN_V1";
    public static final String TYPE_EXERCISE_HR_SUMMARY = "EXERCISE_HR_SUMMARY";

    /** 운동 요약 metricDate 허용 과거 범위(S15P31E105-599): 서버 UTC 오늘 −29일. 폰의 28일 가져오기와 시간대 차이를 감안한 값. */
    public static final int EXERCISE_MAX_PAST_DAYS = 29;

    /** bpm 30~220 정수 구간 수. heartRateSeconds 길이 상한. */
    static final int MAX_HR_BUCKETS = 191;

    /** 운동 1건 최대 길이(초). */
    static final long MAX_EXERCISE_SECONDS = 24 * 3600L;

    /** 초 합 허용 여유(초). 폰은 샘플당 최대 60초까지 센다. */
    static final long HR_SECONDS_SLACK = 60;

    private static final Pattern EXERCISE_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,128}$");

    private static final List<String> EXERCISE_RECORD_KEYS =
            List.of(
                    "type",
                    "exerciseId",
                    "metricDate",
                    "startedAt",
                    "endedAt",
                    "heartRateSeconds",
                    "computedAt");

    private static final Set<String> HR_BUCKET_KEYS = Set.of("bpm", "seconds");

    /** 폰 안정 심박 계산에 필요한 최소 유효 분 수(S15P31E105-600 D-4). */
    static final int MIN_VALID_MINUTE_COUNT = 30;

    /** 폰은 미업로드 값을 7일까지 보관한다(63번). 한 요청은 한 달 분량을 넘지 않는다. */
    public static final int MAX_RECORDS = 31;

    /** metricDate 허용 범위(D-5): 서버 UTC 오늘 −8일 ~ +1일. 폰 7일 보관과 시간대 차이(UTC−12~+14)를 감안한 값. */
    public static final int MAX_PAST_DAYS = 8;

    public static final int MAX_FUTURE_DAYS = 1;

    static final BigDecimal MIN_BPM = BigDecimal.valueOf(30);
    static final BigDecimal MAX_BPM = BigDecimal.valueOf(220);

    /** 24시간의 분 수. validSampleCount는 1분 평균 개수다. */
    static final int MAX_VALID_SAMPLE_COUNT = 1440;

    /** 하루 수면 시간(분) 상한. 0 초과 1440 이하이며 NUMERIC(7,2)에 맞춰 소수 둘째 자리까지 받는다. */
    static final BigDecimal MAX_SLEEP_MIN = BigDecimal.valueOf(1440);

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

    private static final List<String> SLEEP_RECORD_KEYS =
            List.of("type", "metricDate", "sleepDurationMin", "computedAt");

    private static final List<String> RESTING_HR_RECORD_KEYS =
            List.of(
                    "type",
                    "metricDate",
                    "restingHrBpm",
                    "method",
                    "validMinuteCount",
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

    public sealed interface ParsedRecord
            permits DailyHrEstimate,
                    DailySleepSummary,
                    SamsungRestingHr,
                    ExerciseHrSummary,
                    Rejected {
        /** 저장 대상 날짜. 거절 레코드는 저장하지 않으므로 null이다. */
        default LocalDate lockDate() {
            return null;
        }
    }

    /** 저장 대상 추정값. validSampleCount·computedAt·method는 검증만 하고 저장하지 않는다. */
    public record DailyHrEstimate(LocalDate metricDate, int revision, BigDecimal restingHrBpm)
            implements ParsedRecord {
        @Override
        public LocalDate lockDate() {
            return metricDate;
        }
    }

    /** 삼성 헬스 기상일별 수면 합계(분). computedAt은 검증만 하고 저장하지 않는다. */
    public record DailySleepSummary(LocalDate metricDate, BigDecimal sleepDurationMin)
            implements ParsedRecord {
        @Override
        public LocalDate lockDate() {
            return metricDate;
        }
    }

    /** 삼성 헬스 심박으로 폰이 계산한 날짜별 안정 심박. method·validMinuteCount·computedAt은 검증만 하고 저장하지 않는다. */
    public record SamsungRestingHr(LocalDate metricDate, BigDecimal restingHrBpm)
            implements ParsedRecord {
        @Override
        public LocalDate lockDate() {
            return metricDate;
        }
    }

    /**
     * 삼성 헬스 운동 1건의 bpm별 머문 초(S15P31E105-599). 시각은 DB 정밀도(마이크로초)로 자른다. computedAt은 검증만 하고 저장하지 않는다.
     *
     * @param heartRateSeconds bpm(30~220 정수) → 머문 초(양수), bpm 오름차순
     */
    public record ExerciseHrSummary(
            String exerciseId,
            LocalDate metricDate,
            Instant startedAt,
            Instant endedAt,
            SortedMap<Integer, Integer> heartRateSeconds)
            implements ParsedRecord {
        @Override
        public LocalDate lockDate() {
            return metricDate;
        }
    }

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
            // BigDecimal 한계를 넘는 지수(예: 1e2147483648)는 JacksonException이 아니라 NumberFormatException으로
            // 온다.
            // 공통 처리기로 넘기면 500과 입력 원문 로그가 되므로 구문 오류와 같게 거절한다. 원인 메시지는 쓰지 않는다.
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        if (body == null || !body.isObject()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of("fields", List.of(Map.of("name", "body", "reason", "JSON 객체여야 합니다."))));
        }
        // 지원하지 않는 키 이름은 클라이언트가 보낸 임의 문자열이므로 오류에 되돌려 보내지 않는다.
        for (String name : body.propertyNames()) {
            if (!TOP_LEVEL_KEYS.contains(name)) {
                throw new ApiException(
                        ErrorCode.VALIDATION_ERROR,
                        Map.of(
                                "fields",
                                List.of(Map.of("name", "body", "reason", "지원하지 않는 필드가 있습니다."))));
            }
        }
        JsonNode provider = body.get("provider");
        if (provider == null || !provider.isString()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of("fields", List.of(Map.of("name", "provider", "reason", "문자열이어야 합니다."))));
        }
        JsonNode recordsNode = body.get("records");
        if (recordsNode == null || !recordsNode.isArray()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of("fields", List.of(Map.of("name", "records", "reason", "배열이어야 합니다."))));
        }
        if (recordsNode.isEmpty() || recordsNode.size() > MAX_RECORDS) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            "records",
                                            "reason",
                                            "1개 이상 " + MAX_RECORDS + "개 이하여야 합니다."))));
        }
        for (int i = 0; i < recordsNode.size(); i++) {
            if (!recordsNode.get(i).isObject()) {
                throw new ApiException(
                        ErrorCode.VALIDATION_ERROR,
                        Map.of(
                                "fields",
                                List.of(
                                        Map.of(
                                                "name",
                                                "records[" + i + "]",
                                                "reason",
                                                "객체여야 합니다."))));
            }
        }
        boolean watch = PROVIDER_RUNWAY_WATCH.equals(provider.stringValue());
        if (!watch && !PROVIDER_SAMSUNG_HEALTH.equals(provider.stringValue())) {
            throw new ApiException(
                    ErrorCode.UNSUPPORTED_RECORD_TYPE,
                    Map.of(
                            "fields",
                            List.of(Map.of("name", "provider", "reason", "지원하지 않는 값입니다."))));
        }

        LocalDate earliest = today.minusDays(MAX_PAST_DAYS);
        LocalDate exerciseEarliest = today.minusDays(EXERCISE_MAX_PAST_DAYS);
        LocalDate latest = today.plusDays(MAX_FUTURE_DAYS);
        List<ParsedRecord> records = new ArrayList<>(recordsNode.size());
        for (int i = 0; i < recordsNode.size(); i++) {
            try {
                JsonNode node = recordsNode.get(i);
                records.add(
                        watch
                                ? parseRecord(node, earliest, latest)
                                : isRestingHr(node)
                                        ? parseRestingHrRecord(node, earliest, latest)
                                        : isType(node, TYPE_EXERCISE_HR_SUMMARY)
                                                ? parseExerciseRecord(
                                                        node, exerciseEarliest, latest)
                                                : parseSleepRecord(node, earliest, latest));
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
        BigDecimal bpm = restingHr(record.get("estimatedRestingHrBpm"), "estimatedRestingHrBpm");
        JsonNode method = record.get("method");
        if (!method.isString() || !METHOD_ROLLING24H_V2.equals(method.stringValue())) {
            throw unsupported("method");
        }
        intIn(record.get("validSampleCount"), "validSampleCount", 1, MAX_VALID_SAMPLE_COUNT);
        computedAt(record.get("computedAt"));
        return new DailyHrEstimate(metricDate, revision, bpm);
    }

    private static DailySleepSummary parseSleepRecord(
            JsonNode record, LocalDate earliest, LocalDate latest) {
        for (String name : record.propertyNames()) {
            if (!SLEEP_RECORD_KEYS.contains(name)) {
                throw invalid(null, "UNKNOWN_FIELD");
            }
        }
        for (String key : SLEEP_RECORD_KEYS) {
            if (!record.has(key)) {
                throw invalid(key, "REQUIRED");
            }
        }
        JsonNode type = record.get("type");
        if (!type.isString() || !TYPE_DAILY_SLEEP_SUMMARY.equals(type.stringValue())) {
            throw unsupported("type");
        }
        LocalDate metricDate = metricDate(record.get("metricDate"), earliest, latest);
        BigDecimal minutes = sleepMinutes(record.get("sleepDurationMin"));
        computedAt(record.get("computedAt"));
        return new DailySleepSummary(metricDate, minutes);
    }

    private static boolean isRestingHr(JsonNode record) {
        return isType(record, TYPE_DAILY_RESTING_HR);
    }

    private static boolean isType(JsonNode record, String expected) {
        JsonNode type = record.get("type");
        return type != null && type.isString() && expected.equals(type.stringValue());
    }

    /**
     * 검사 순서: 정의되지 않은 키 → 필수 키 → exerciseId → metricDate → startedAt → endedAt(시작 이후·24시간 이하) → heartRateSeconds
     * (배열 1~191개, 원소 {bpm, seconds} 객체, bpm 30~220 정수·중복 없음, seconds 1~86400 정수, 초 합 ≤ 길이 + 60) → computedAt.
     */
    private static ExerciseHrSummary parseExerciseRecord(
            JsonNode record, LocalDate earliest, LocalDate latest) {
        for (String name : record.propertyNames()) {
            if (!EXERCISE_RECORD_KEYS.contains(name)) {
                throw invalid(null, "UNKNOWN_FIELD");
            }
        }
        for (String key : EXERCISE_RECORD_KEYS) {
            if (!record.has(key)) {
                throw invalid(key, "REQUIRED");
            }
        }
        JsonNode id = record.get("exerciseId");
        if (!id.isString()) {
            throw invalid("exerciseId", "INVALID_TYPE");
        }
        if (!EXERCISE_ID.matcher(id.stringValue()).matches()) {
            throw invalid("exerciseId", "INVALID_FORMAT");
        }
        LocalDate metricDate = metricDate(record.get("metricDate"), earliest, latest);
        Instant startedAt = utcInstant(record.get("startedAt"), "startedAt");
        Instant endedAt = utcInstant(record.get("endedAt"), "endedAt");
        if (endedAt.isBefore(startedAt)
                || Duration.between(startedAt, endedAt).toSeconds() > MAX_EXERCISE_SECONDS) {
            throw invalid("endedAt", "OUT_OF_RANGE");
        }
        long durationSeconds = Duration.between(startedAt, endedAt).toSeconds();
        String field = "heartRateSeconds";
        JsonNode buckets = record.get(field);
        if (!buckets.isArray()) {
            throw invalid(field, "INVALID_TYPE");
        }
        if (buckets.isEmpty() || buckets.size() > MAX_HR_BUCKETS) {
            throw invalid(field, "OUT_OF_RANGE");
        }
        SortedMap<Integer, Integer> histogram = new TreeMap<>();
        long total = 0;
        for (JsonNode bucket : buckets) {
            if (!bucket.isObject()
                    || !HR_BUCKET_KEYS.equals(Set.copyOf(bucket.propertyNames()))) {
                throw invalid(field, "INVALID_FORMAT");
            }
            int bpm = intIn(bucket.get("bpm"), field, 30, 220);
            int seconds = intIn(bucket.get("seconds"), field, 1, (int) MAX_EXERCISE_SECONDS);
            if (histogram.put(bpm, seconds) != null) {
                throw invalid(field, "INVALID_FORMAT");
            }
            total += seconds;
        }
        if (total > durationSeconds + HR_SECONDS_SLACK) {
            throw invalid(field, "OUT_OF_RANGE");
        }
        computedAt(record.get("computedAt"));
        return new ExerciseHrSummary(
                id.stringValue(),
                metricDate,
                startedAt.truncatedTo(ChronoUnit.MICROS),
                endedAt.truncatedTo(ChronoUnit.MICROS),
                Collections.unmodifiableSortedMap(histogram));
    }

    private static Instant utcInstant(JsonNode node, String field) {
        if (!node.isString() || !UTC_INSTANT.matcher(node.stringValue()).matches()) {
            throw invalid(field, "INVALID_FORMAT");
        }
        try {
            return Instant.parse(node.stringValue());
        } catch (DateTimeException e) {
            throw invalid(field, "INVALID_FORMAT");
        }
    }

    private static SamsungRestingHr parseRestingHrRecord(
            JsonNode record, LocalDate earliest, LocalDate latest) {
        for (String name : record.propertyNames()) {
            if (!RESTING_HR_RECORD_KEYS.contains(name)) {
                throw invalid(null, "UNKNOWN_FIELD");
            }
        }
        for (String key : RESTING_HR_RECORD_KEYS) {
            if (!record.has(key)) {
                throw invalid(key, "REQUIRED");
            }
        }
        LocalDate metricDate = metricDate(record.get("metricDate"), earliest, latest);
        BigDecimal bpm = restingHr(record.get("restingHrBpm"), "restingHrBpm");
        JsonNode method = record.get("method");
        if (!method.isString() || !METHOD_DAILY_LOWER_10PCT_V1.equals(method.stringValue())) {
            throw unsupported("method");
        }
        intIn(
                record.get("validMinuteCount"),
                "validMinuteCount",
                MIN_VALID_MINUTE_COUNT,
                MAX_VALID_SAMPLE_COUNT);
        computedAt(record.get("computedAt"));
        return new SamsungRestingHr(metricDate, bpm);
    }

    /** 0 초과 1440분 이하, 소수 둘째 자리까지. 0은 미측정과 구분할 수 없으므로 받지 않는다. */
    private static BigDecimal sleepMinutes(JsonNode node) {
        String field = "sleepDurationMin";
        if (!node.isNumber()) {
            throw invalid(field, "INVALID_TYPE");
        }
        BigDecimal value;
        try {
            value = node.decimalValue();
        } catch (RuntimeException e) {
            throw invalid(field, "INVALID_TYPE");
        }
        if (value.signum() <= 0 || value.compareTo(MAX_SLEEP_MIN) > 0) {
            throw invalid(field, "OUT_OF_RANGE");
        }
        if (Math.max(value.stripTrailingZeros().scale(), 0) > 2) {
            throw invalid(field, "TOO_MANY_DECIMALS");
        }
        return value;
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
    private static BigDecimal restingHr(JsonNode node, String field) {
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
        return new RecordViolation(HealthRecordErrorCode.INVALID_RECORD.name(), field, reason);
    }

    private static RecordViolation unsupported(String field) {
        return new RecordViolation(
                HealthRecordErrorCode.UNSUPPORTED_RECORD_TYPE.name(), field, "UNSUPPORTED");
    }
}
