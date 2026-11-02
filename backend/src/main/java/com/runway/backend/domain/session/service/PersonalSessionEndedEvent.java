package com.runway.backend.domain.session.service;

import java.time.Instant;

/**
 * 개인 세션 종료(S06 END/APPLIED)가 처음 확정될 때 한 번 발행한다. 분석 요청과 그룹 종료 확인의 연결 지점이다.
 *
 * <p>발행은 결과 저장 트랜잭션 안에서 일어나므로 소비자는 {@code @TransactionalEventListener(phase = AFTER_COMMIT)}로 받아 커밋된 종료만
 * 처리해야 한다. 같은 결과 재전송은 발행하지 않는다. S15P31E105-256에는 소비자가 없으며 analysisStatus는 PENDING으로 남는다.
 *
 * @param groupRunId 그룹에 연결된 세션이면 그룹런 ID, 아니면 null
 * @param endedAt 실행기기가 보고한 실제 종료시각
 */
public record PersonalSessionEndedEvent(long sessionId, Long groupRunId, Instant endedAt) {}
