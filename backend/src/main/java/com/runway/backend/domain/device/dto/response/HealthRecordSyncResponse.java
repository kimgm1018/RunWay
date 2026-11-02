package com.runway.backend.domain.device.dto.response;

import java.util.List;

/**
 * W06 응답. acceptedCount + duplicateCount + rejectedCount는 요청 records 길이와 같다. errors는 거절한 레코드마다 하나다.
 *
 * @param acceptedCount 새로 저장했거나 저장된 revision보다 큰 revision으로 갱신한 레코드 수
 * @param duplicateCount 저장된 revision이 같거나 더 커서 갱신하지 않은 레코드 수
 * @param rejectedCount 검증에서 거절한 레코드 수
 */
public record HealthRecordSyncResponse(
        int acceptedCount, int duplicateCount, int rejectedCount, List<RecordError> errors) {

    /**
     * 거절한 레코드 하나의 첫 위반. 값 원문은 담지 않는다.
     *
     * @param index 요청 records 배열 위치(0부터)
     * @param code INVALID_RECORD 또는 UNSUPPORTED_RECORD_TYPE
     * @param field 위반 필드 이름. 정의되지 않은 키가 있으면 null(키 이름을 되돌려 보내지 않는다)
     * @param reason REQUIRED, UNKNOWN_FIELD, INVALID_TYPE, INVALID_FORMAT, OUT_OF_RANGE, TOO_MANY_DECIMALS,
     *     UNSUPPORTED
     */
    public record RecordError(int index, String code, String field, String reason) {}
}
