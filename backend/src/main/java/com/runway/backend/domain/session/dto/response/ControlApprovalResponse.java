package com.runway.backend.domain.session.dto.response;

import com.runway.backend.domain.session.entity.SessionControlEvent;

/** S03~S06 REQUEST 응답. 같은 요청 슬롯의 재전송에는 저장된 명령과 현재 결과를 그대로 돌려준다. */
public record ControlApprovalResponse(
        long commandId,
        String action,
        long expectedVersion,
        Integer targetBpm,
        Long coachingId,
        String result) {

    public static ControlApprovalResponse of(SessionControlEvent event) {
        return new ControlApprovalResponse(
                event.getId(),
                event.getAction().name(),
                event.getExpectedVersion(),
                event.getTargetBpm(),
                event.getCoachingId(),
                event.getResult().name());
    }
}
