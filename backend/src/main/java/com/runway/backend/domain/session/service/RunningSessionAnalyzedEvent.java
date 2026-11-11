package com.runway.backend.domain.session.service;

/**
 * 종료 후 분석이 READY로 저장될 때 그 트랜잭션 안에서 발행한다(S15P31E105-599). 러닝 부하 저장이 구독하며, 소비자는 커밋 후
 * ({@code @TransactionalEventListener} AFTER_COMMIT) 받아야 한다. 분석이 실패(FAILED)하면 발행하지 않는다. 건강 값은 담지 않는다.
 */
public record RunningSessionAnalyzedEvent(long sessionId) {}
