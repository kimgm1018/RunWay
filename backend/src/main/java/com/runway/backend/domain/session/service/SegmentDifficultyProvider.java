package com.runway.backend.domain.session.service;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/**
 * 1km 구간별 상대 난이도 비율을 제공하는 연결점. AI 코스 분석이 연동되면 이 인터페이스의 구현을 AI 결과를 읽는 Bean으로 교체한다.
 *
 * 비율은 상대값이다. 값이 클수록 힘든 구간이며 절대 크기는 의미가 없다(1.0·1.2·0.8과 10·12·8은 같은 계획). 계산기는 전체 목표 시간이 그대로
 * 유지되도록 거리 가중 평균으로 정규화한다.
 *
 * 호출 시점은 세션 생성·목표 변경 트랜잭션 안이며 회원 advisory lock 또는 세션 행 잠금을 잡은 상태다. 실제 구현은 원격 AI를 동기 호출하지
 * 말고 미리 계산·저장된 코스별 결과를 읽어야 한다. 원격 호출이 필요해지면 잠금 전에 비율을 받아오도록 서비스 흐름을 바꾼다.
 *
 * AI 구현 Bean을 추가할 때 {@link UniformSegmentDifficultyProvider}를 제거한다. 함께 두어야 하면 AI 구현에 {@code @Primary}를 붙인다.
 * 둘 다 일반 Bean이면 같은 타입 Bean이 두 개라 애플리케이션이 기동하지 않는다.
 */
public interface SegmentDifficultyProvider {

    /**
     * @param courseId 선택 코스. 자유러닝이면 null이며 지형 정보가 없으므로 보통 빈 값을 돌려준다
     * @param totalDistanceM 계획 끝 거리(m). 목표 거리, 없으면 코스 거리
     * @param segmentCount 1km 단위 구간 수. 마지막 구간은 1km보다 짧을 수 있다
     * @return 구간 순서대로 segmentCount개의 양수 비율. 비율이 없으면 빈 값이며 균등 분배한다
     */
    Optional<List<BigDecimal>> ratios(Long courseId, BigDecimal totalDistanceM, int segmentCount);
}
