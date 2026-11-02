package com.runway.backend.domain.device.dto.response;

/**
 * W07 서버 저장 ACK. 최초 저장과 동일 batch 재응답이 같은 형식이다.
 *
 * @param status 저장 확인은 항상 COMMITTED
 * @param batchId 요청 id와 같은 UUID 문자열(원래 표기 유지). 서버 행 번호 sync_batches.id가 아니다
 * @param acceptedCount 이 batch의 저장 확인 항목 수(items 길이). 실제 신규 삽입 수가 아니다
 */
public record SyncBatchAckResponse(String status, String batchId, int acceptedCount) {}
