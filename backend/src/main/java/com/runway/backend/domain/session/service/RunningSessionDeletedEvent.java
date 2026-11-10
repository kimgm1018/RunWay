package com.runway.backend.domain.session.service;

/**
 * S09 러닝 삭제가 저장될 때 그 트랜잭션 안에서 발행한다(S15P31E105-599). 러닝 부하 저장이 커밋 후 받아 그 러닝의 부하를 지운다.
 */
public record RunningSessionDeletedEvent(long sessionId) {}
