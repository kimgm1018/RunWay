package com.runway.backend.domain.session.service;

/**
 * 그룹 세션의 시작이 최종 정리된 순간(START 거절 확정, S08 시작 미확인 중단). 개인 END 확정({@link PersonalSessionEndedEvent})과 함께 그룹
 * 자동 종료 확인의 트리거다(S15P31E105-734). 결과 저장 트랜잭션 안에서 발행하므로 소비자는 커밋 뒤에 처리한다.
 */
public record GroupParticipantSettledEvent(long sessionId, long groupRunId) {}
