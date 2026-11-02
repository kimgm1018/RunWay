package com.runway.backend.domain.device.service;

import com.runway.backend.domain.device.dto.request.SyncBatchRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.erdtman.jcs.JsonCanonicalizer;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamWriteFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * W07 payloadHash(devices-health.md "해시·불변성·중복 처리" 1항). payloadHash를 뺀 본문에서 deviceId·sessionId만 파싱한
 * 정수의 십진 문자열로 바꾸고, 나머지(id 원래 표기 포함)는 RFC 8785 JCS로 정규화한 UTF-8 바이트의 SHA-256을 소문자 hex로 만든다.
 *
 * <p>호출 전에 요청 검증을 마쳐야 한다. 숫자는 Jackson이 읽은 원문 BigDecimal을 지수 없이 쓰고 JCS가 IEEE 754 double의 ES6
 * 표기로 정규화한다.
 */
public final class BatchPayloadHasher {

    private static final JsonMapper WRITER =
            JsonMapper.builder().enable(StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN).build();

    private BatchPayloadHasher() {}

    /** 본문 해시를 다시 계산해 payloadHash와 비교한다. 다르면 422 INVALID_BATCH. */
    public static String verify(SyncBatchRequest request) {
        String hash = hash(request.body(), request.deviceId(), request.sessionId());
        if (!hash.equals(request.payloadHash())) {
            throw SyncBatchErrors.invalidBatch("payloadHash", "본문 해시와 일치하지 않습니다.");
        }
        return hash;
    }

    public static String hash(JsonNode body, long deviceId, long sessionId) {
        ObjectNode projection = (ObjectNode) body.deepCopy();
        projection.remove("payloadHash");
        projection.put("deviceId", Long.toString(deviceId));
        projection.put("sessionId", Long.toString(sessionId));
        try {
            byte[] json = WRITER.writeValueAsString(projection).getBytes(StandardCharsets.UTF_8);
            byte[] canonical = new JsonCanonicalizer(json).getEncodedUTF8();
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical));
        } catch (IOException | JacksonException e) {
            // 검증을 통과한 본문은 정규화에 실패하지 않는다. 실패하면 해시 위반으로 거절한다.
            throw SyncBatchErrors.invalidBatch("payloadHash", "해시를 계산할 수 없습니다.");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
