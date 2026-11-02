package com.runway.backend.domain.session.dto.response;

import com.fasterxml.jackson.annotation.JsonUnwrapped;

/**
 * S03~S06 RESULT 응답. 명령 결과와 서버 저장 확인(persisted=true)에 S02 전체 세션 상태(stateVersion·state·currentBpm 포함)를 같은 단계로
 * 펼쳐 반환한다.
 */
public record ControlResultResponse(
        long commandId,
        String result,
        boolean persisted,
        @JsonUnwrapped RunningSessionResponse session) {}
