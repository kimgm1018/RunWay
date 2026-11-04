package com.runway.backend.domain.device.dto.request;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * W07 요청. 원문 바이트를 직접 파싱해 중복 키·NaN을 거절하고 소수를 BigDecimal 원문 그대로 읽는다.
 *
 * <p>오류 구분(devices-health.md W07): 최상위 JSON 구문·필수 필드·자료형·ID 범위는 400 VALIDATION_ERROR, 최상위 추가
 * 필드·지원하지 않는 schemaVersion·빈 items와 items 안의 모든 위반(타입·키 누락/추가·자료형·단위/범위/자릿수)은 422 INVALID_BATCH다.
 * 해시 검증은 서비스가 이 파싱 결과의 원문 트리로 수행한다.
 *
 * @param id 요청 원문 그대로의 batch UUID 문자열(대소문자 유지)
 * @param body 해시 계산용 원문 트리
 */
public record SyncBatchRequest(
        String id,
        UUID clientBatchId,
        long deviceId,
        long sessionId,
        String schemaVersion,
        String payloadHash,
        List<SyncBatchItem> items,
        JsonNode body) {

    /** 지원하는 schemaVersion. 타입 목록·해시 규칙이 바뀌면 새 버전을 등록한다. */
    public static final Set<String> SUPPORTED_SCHEMA_VERSIONS = Set.of("1");

    private static final Set<String> TOP_LEVEL_KEYS =
            Set.of("id", "deviceId", "sessionId", "schemaVersion", "payloadHash", "items");
    private static final Set<String> METRIC_KEYS =
            Set.of(
                    "type",
                    "measuredAt",
                    "elapsedDurationSec",
                    "heartRateBpm",
                    "cadenceSpm",
                    "speedMps",
                    "gradePercent",
                    "totalDistanceM",
                    "routeProgressM",
                    "isHrMeasured");
    private static final Set<String> GPS_KEYS =
            Set.of("type", "measuredAt", "coordinates", "accuracyM", "altitudeM");

    private static final Pattern UUID_V4 =
            Pattern.compile(
                    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$");
    private static final Pattern SHA256_HEX = Pattern.compile("^[0-9a-f]{64}$");

    /**
     * UTC(Z) ISO 8601. TIMESTAMPTZ가 마이크로초까지 저장하므로 소수 6자리를 넘으면 반올림하지 않고 거절한다. 24:00·윤초(:60)는 다른 시각으로
     * 바뀌어 저장되므로 거절한다.
     */
    private static final Pattern UTC_INSTANT =
            Pattern.compile(
                    "^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d{1,6})?Z$");

    private static final JsonMapper STRICT =
            JsonMapper.builder()
                    .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                    .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
                    .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .build();

    public sealed interface SyncBatchItem permits MetricSample, GpsPoint {
        Instant measuredAt();
    }

    /** 미측정 값은 null이다. 0이나 과거 값으로 채우지 않는다. */
    public record MetricSample(
            Instant measuredAt,
            int elapsedDurationSec,
            BigDecimal heartRateBpm,
            BigDecimal cadenceSpm,
            BigDecimal speedMps,
            BigDecimal gradePercent,
            BigDecimal totalDistanceM,
            BigDecimal routeProgressM,
            boolean isHrMeasured)
            implements SyncBatchItem {}

    /** WGS84 경도·위도. */
    public record GpsPoint(
            Instant measuredAt,
            double longitude,
            double latitude,
            BigDecimal accuracyM,
            BigDecimal altitudeM)
            implements SyncBatchItem {}

    public boolean hasMetricSample() {
        return items.stream().anyMatch(MetricSample.class::isInstance);
    }

    public static SyncBatchRequest parse(byte[] raw) {
        JsonNode body;
        try {
            body = STRICT.readTree(raw);
        } catch (JacksonException e) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }
        if (body == null || !body.isObject()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of("fields", List.of(Map.of("name", "body", "reason", "JSON 객체여야 합니다."))));
        }

        String id = requireTopString(body, "id");
        if (!UUID_V4.matcher(id).matches()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of(
                            "fields",
                            List.of(Map.of("name", "id", "reason", "UUID v4 문자열이어야 합니다."))));
        }
        long deviceId = requirePositiveLong(body, "deviceId");
        long sessionId = requirePositiveLong(body, "sessionId");
        String schemaVersion = requireTopString(body, "schemaVersion");
        String payloadHash = requireTopString(body, "payloadHash");
        if (!SHA256_HEX.matcher(payloadHash).matches()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            "payloadHash",
                                            "reason",
                                            "소문자 16진수 64자리여야 합니다."))));
        }
        JsonNode itemsNode = body.get("items");
        if (itemsNode == null || !itemsNode.isArray()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of("fields", List.of(Map.of("name", "items", "reason", "배열이어야 합니다."))));
        }

        // 지원하지 않는 키 이름은 클라이언트가 보낸 임의 문자열이므로 오류에 되돌려 보내지 않는다.
        for (String name : body.propertyNames()) {
            if (!TOP_LEVEL_KEYS.contains(name)) {
                throw new ApiException(
                        ErrorCode.INVALID_BATCH,
                        Map.of(
                                "fields",
                                List.of(Map.of("name", "body", "reason", "지원하지 않는 필드가 있습니다."))));
            }
        }
        if (!SUPPORTED_SCHEMA_VERSIONS.contains(schemaVersion)) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(Map.of("name", "schemaVersion", "reason", "지원하지 않는 버전입니다."))));
        }
        if (itemsNode.isEmpty()) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(Map.of("name", "items", "reason", "항목이 1개 이상이어야 합니다."))));
        }
        List<SyncBatchItem> items = new ArrayList<>(itemsNode.size());
        for (int i = 0; i < itemsNode.size(); i++) {
            items.add(parseItem(itemsNode.get(i), "items[" + i + "]"));
        }
        return new SyncBatchRequest(
                id,
                UUID.fromString(id),
                deviceId,
                sessionId,
                schemaVersion,
                payloadHash,
                List.copyOf(items),
                body);
    }

    private static SyncBatchItem parseItem(JsonNode item, String path) {
        if (item == null || !item.isObject()) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of("fields", List.of(Map.of("name", path, "reason", "객체여야 합니다."))));
        }
        JsonNode type = item.get("type");
        if (type == null || !type.isString()) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(Map.of("name", path + ".type", "reason", "지원하지 않는 타입입니다."))));
        }
        return switch (type.stringValue()) {
            case "METRIC_SAMPLE" -> parseMetric(item, path);
            case "GPS_POINT" -> parseGps(item, path);
            default ->
                    throw new ApiException(
                            ErrorCode.INVALID_BATCH,
                            Map.of(
                                    "fields",
                                    List.of(
                                            Map.of(
                                                    "name",
                                                    path + ".type",
                                                    "reason",
                                                    "지원하지 않는 타입입니다."))));
        };
    }

    private static MetricSample parseMetric(JsonNode item, String path) {
        requireExactKeys(item, path, METRIC_KEYS);
        Instant measuredAt = measuredAt(item, path);
        JsonNode elapsed = item.get("elapsedDurationSec");
        if (!elapsed.isIntegralNumber() || !elapsed.canConvertToInt() || elapsed.intValue() < 0) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            path + ".elapsedDurationSec",
                                            "reason",
                                            "0 이상의 정수여야 합니다."))));
        }
        BigDecimal heartRate = decimal(item, path, "heartRateBpm", 5, 2, Sign.POSITIVE);
        BigDecimal cadence = decimal(item, path, "cadenceSpm", 6, 2, Sign.NON_NEGATIVE);
        BigDecimal speed = decimal(item, path, "speedMps", 7, 3, Sign.NON_NEGATIVE);
        BigDecimal grade = decimal(item, path, "gradePercent", 4, 3, Sign.ANY);
        BigDecimal totalDistance = decimal(item, path, "totalDistanceM", 10, 2, Sign.NON_NEGATIVE);
        BigDecimal routeProgress = decimal(item, path, "routeProgressM", 10, 2, Sign.NON_NEGATIVE);
        JsonNode measured = item.get("isHrMeasured");
        if (!measured.isBoolean()) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            path + ".isHrMeasured",
                                            "reason",
                                            "true 또는 false여야 합니다."))));
        }
        boolean isHrMeasured = measured.booleanValue();
        if (isHrMeasured != (heartRate != null)) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            path + ".heartRateBpm",
                                            "reason",
                                            "isHrMeasured=true이면 필수, false이면 null이어야 합니다."))));
        }
        if (heartRate == null
                && cadence == null
                && speed == null
                && grade == null
                && totalDistance == null
                && routeProgress == null) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(Map.of("name", path, "reason", "측정값이 하나 이상 있어야 합니다."))));
        }
        return new MetricSample(
                measuredAt,
                elapsed.intValue(),
                heartRate,
                cadence,
                speed,
                grade,
                totalDistance,
                routeProgress,
                isHrMeasured);
    }

    private static GpsPoint parseGps(JsonNode item, String path) {
        requireExactKeys(item, path, GPS_KEYS);
        Instant measuredAt = measuredAt(item, path);
        JsonNode coordinates = item.get("coordinates");
        if (!coordinates.isArray()
                || coordinates.size() != 2
                || !coordinates.get(0).isNumber()
                || !coordinates.get(1).isNumber()) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            path + ".coordinates",
                                            "reason",
                                            "[경도, 위도] 숫자 배열이어야 합니다."))));
        }
        BigDecimal longitude = coordinates.get(0).decimalValue();
        BigDecimal latitude = coordinates.get(1).decimalValue();
        if (longitude.abs().compareTo(BigDecimal.valueOf(180)) > 0
                || latitude.abs().compareTo(BigDecimal.valueOf(90)) > 0) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            path + ".coordinates",
                                            "reason",
                                            "경도는 -180~180, 위도는 -90~90이어야 합니다."))));
        }
        BigDecimal accuracy = decimal(item, path, "accuracyM", 8, 2, Sign.NON_NEGATIVE);
        BigDecimal altitude = decimal(item, path, "altitudeM", 8, 2, Sign.ANY);
        return new GpsPoint(
                measuredAt, longitude.doubleValue(), latitude.doubleValue(), accuracy, altitude);
    }

    private enum Sign {
        ANY,
        NON_NEGATIVE,
        POSITIVE
    }

    /** 숫자 또는 null. DB NUMERIC(정수부+소수부) 자릿수를 넘으면 반올림하지 않고 거절한다. 키 존재는 호출 전에 확인했다. */
    private static BigDecimal decimal(
            JsonNode item, String path, String name, int integerDigits, int scale, Sign sign) {
        JsonNode node = item.get(name);
        if (node.isNull()) {
            return null;
        }
        String field = path + "." + name;
        if (!node.isNumber()) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(Map.of("name", field, "reason", "숫자 또는 null이어야 합니다."))));
        }
        BigDecimal value = node.decimalValue();
        BigDecimal stripped = value.stripTrailingZeros();
        if (Math.max(stripped.scale(), 0) > scale
                || stripped.precision() - stripped.scale() > integerDigits) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            field,
                                            "reason",
                                            "정수부 "
                                                    + integerDigits
                                                    + "자리, 소수 "
                                                    + scale
                                                    + "자리까지 허용됩니다."))));
        }
        boolean signOk =
                switch (sign) {
                    case ANY -> true;
                    case NON_NEGATIVE -> value.signum() >= 0;
                    case POSITIVE -> value.signum() > 0;
                };
        if (!signOk) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            field,
                                            "reason",
                                            sign == Sign.POSITIVE
                                                    ? "0보다 커야 합니다."
                                                    : "0 이상이어야 합니다."))));
        }
        return value;
    }

    private static Instant measuredAt(JsonNode item, String path) {
        JsonNode node = item.get("measuredAt");
        String field = path + ".measuredAt";
        if (!node.isString() || !UTC_INSTANT.matcher(node.stringValue()).matches()) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            field,
                                            "reason",
                                            "UTC(Z) ISO 8601 시각이어야 합니다."))));
        }
        try {
            return Instant.parse(node.stringValue());
        } catch (DateTimeException e) {
            throw new ApiException(
                    ErrorCode.INVALID_BATCH,
                    Map.of(
                            "fields",
                            List.of(
                                    Map.of(
                                            "name",
                                            field,
                                            "reason",
                                            "UTC(Z) ISO 8601 시각이어야 합니다."))));
        }
    }

    /** 모든 키가 있어야 하며(null 허용 필드도 키는 포함) 추가 키는 허용하지 않는다. */
    private static void requireExactKeys(JsonNode item, String path, Set<String> keys) {
        for (String name : item.propertyNames()) {
            if (!keys.contains(name)) {
                throw new ApiException(
                        ErrorCode.INVALID_BATCH,
                        Map.of(
                                "fields",
                                List.of(Map.of("name", path, "reason", "지원하지 않는 필드가 있습니다."))));
            }
        }
        for (String key : keys) {
            if (!item.has(key)) {
                throw new ApiException(
                        ErrorCode.INVALID_BATCH,
                        Map.of(
                                "fields",
                                List.of(Map.of("name", path + "." + key, "reason", "필수 필드입니다."))));
            }
        }
    }

    private static String requireTopString(JsonNode body, String name) {
        JsonNode node = body.get(name);
        if (node == null || !node.isString()) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of("fields", List.of(Map.of("name", name, "reason", "문자열이어야 합니다."))));
        }
        return node.stringValue();
    }

    private static long requirePositiveLong(JsonNode body, String name) {
        JsonNode node = body.get(name);
        if (node == null
                || !node.isIntegralNumber()
                || !node.canConvertToLong()
                || node.longValue() <= 0) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR,
                    Map.of(
                            "fields",
                            List.of(Map.of("name", name, "reason", "양의 int64 정수여야 합니다."))));
        }
        return node.longValue();
    }
}
