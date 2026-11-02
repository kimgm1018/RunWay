package com.runway.backend.domain.session.dto.request;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;

/**
 * S08 요청의 문서용 스키마. 실제 요청은 원본 JSON을 {@link UpdateRunningSessionRequest#from}에서 검증하며, 목표 필드는 최상위에 두고 생략(유지)과
 * null(해제)을 구분하므로 요청 DTO 구조와 다르다. 작업에 해당하지 않는 필드가 오면 400이다.
 */
@Schema(name = "UpdateRunningSessionRequest", description = "operation별로 필요한 필드만 보낸다")
public record UpdateRunningSessionRequestSchema(
        @Schema(
                        requiredMode = Schema.RequiredMode.REQUIRED,
                        allowableValues = {
                            "UPDATE_GOAL",
                            "REPORT_PREPARED",
                            "TAKE_OVER_PHONE",
                            "ABORT_UNCONFIRMED_START"
                        })
                String operation,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1", description = "마지막으로 본 stateVersion")
                long expectedVersion,
        @Schema(description = "REPORT_PREPARED(워치)·TAKE_OVER_PHONE·ABORT_UNCONFIRMED_START(폰) 필수")
                Long deviceId,
        @Schema(description = "REPORT_PREPARED 필수") Boolean ready,
        @Schema(description = "REPORT_PREPARED 선택, 최대 64자", nullable = true) String reasonCode,
        @Schema(description = "TAKE_OVER_PHONE 필수. 워치에서 받은 배치를 모두 올렸는지")
                Boolean receivedWatchBatchesUploaded,
        @Schema(description = "UPDATE_GOAL. 생략은 유지, null은 해제", nullable = true) Long courseId,
        @Schema(description = "UPDATE_GOAL. 생략은 유지, null은 해제", nullable = true)
                Long comparisonSessionId,
        @Schema(description = "UPDATE_GOAL. 생략은 유지, null은 해제. 1~45000", nullable = true)
                Integer targetDistanceM,
        @Schema(description = "UPDATE_GOAL. 생략은 유지, null은 해제", nullable = true)
                Integer targetDurationSec,
        @Schema(description = "UPDATE_GOAL. 생략은 유지, null은 해제. 소수 둘째 자리까지", nullable = true)
                BigDecimal targetPaceSecPerKm) {}
