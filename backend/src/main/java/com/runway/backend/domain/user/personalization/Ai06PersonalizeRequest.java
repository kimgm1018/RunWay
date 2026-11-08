package com.runway.backend.domain.user.personalization;

import java.util.List;

/**
 * AI06 {@code POST /v1/hr/personalize} 요청 본문(ai-service.md AI06). 필드 이름이 곧 JSON 키다. 심박·경사 값이 들어 있으므로
 * 본문과 {@code toString()}을 로그에 남기지 않는다.
 *
 * @param userId 양수 서버 회원 ID
 * @param sessions 완료 support 러닝 1~50개(시작 최신순)
 */
public record Ai06PersonalizeRequest(long userId, List<Ai06Session> sessions) {

    @Override
    public String toString() {
        return "Ai06PersonalizeRequest[REDACTED]";
    }
}
