package com.runway.backend.domain.device.service;

/** W07이 새 측정 batch를 저장했다. 커밋 뒤 서버 코칭 발행 조건을 다시 판단하는 데 쓴다. 측정값은 담지 않는다. */
public record RunningBatchCommittedEvent(long sessionId) {}
