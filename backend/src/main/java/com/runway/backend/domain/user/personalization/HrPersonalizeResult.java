package com.runway.backend.domain.user.personalization;

import com.runway.backend.domain.user.model.HrPersonalizationCommand;

/** AI06 호출 결과. 호출자는 {@link Success}만 저장한다. */
public sealed interface HrPersonalizeResult {

    /** 2xx 응답을 저장 값으로 매핑한 결과. */
    record Success(HrPersonalizationCommand command) implements HrPersonalizeResult {}

    /** 422 {@code INPUT_INSUFFICIENT}. 저장하지 않는다. */
    record InputInsufficient() implements HrPersonalizeResult {}

    /**
     * 그 밖의 실패. 재시도·저장 없음.
     *
     * @param reason 실패 종류
     * @param httpStatus 응답을 받은 경우의 상태 코드, 없으면 0
     */
    record Failure(Reason reason, int httpStatus) implements HrPersonalizeResult {}

    /** 실패 종류. 본문·메시지는 담지 않는다. */
    enum Reason {
        /** base-url 미설정, 연결 실패 등 전송 오류. */
        UNAVAILABLE,
        TIMEOUT,
        /** AI_BUSY 재시도를 모두 썼다. */
        BUSY_RETRIES_EXHAUSTED,
        /** 계약에 없는 상태 코드·오류 코드. */
        HTTP_ERROR,
        /** 2xx지만 응답이 계약을 벗어났거나 본문 상한 초과. */
        INVALID_RESPONSE,
        /** 요청 직렬화 실패나 호출 중단. */
        INTERNAL
    }
}
