package com.runway.backend.domain.coaching.decide;

import java.util.Optional;

/**
 * 러닝 중 페이스 판단(AI04) 포트. 구현은 원격 호출이므로 DB 트랜잭션·세션 잠금 밖에서만 부른다.
 *
 * <p>실패(주소 미설정·연결 실패·시간 초과·오류 응답·계약 위반)와 판단 없음({@code decision=null})은 모두 빈 값이다. 구현은 재시도하지 않으며,
 * 다음 W07 batch의 최신 입력에서 다시 판단한다(ai-service.md N7-5·O14).
 */
public interface PaceDecider {

    Optional<PaceDecision> decide(PaceDecideRequest request);
}
