package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SessionControlEventRepository extends JpaRepository<SessionControlEvent, Long> {

    /** uq_control_pending으로 세션·기기별 미확정 명령은 최대 하나다. */
    Optional<SessionControlEvent> findFirstBySessionIdAndDeviceIdAndResultIn(
            Long sessionId, Long deviceId, Collection<ControlResult> results);

    Optional<SessionControlEvent> findFirstBySessionIdOrderByIdDesc(Long sessionId);

    /** uq_control_version으로 세션·기준 버전별 요청 슬롯은 최대 하나다. */
    Optional<SessionControlEvent> findBySessionIdAndExpectedVersion(
            Long sessionId, Long expectedVersion);

    /** G09 재요청 복원용. 그룹 연결 세션의 START는 G09가 만든 첫 명령뿐이다. */
    Optional<SessionControlEvent> findFirstBySessionIdAndActionOrderByIdAsc(
            Long sessionId, ControlAction action);

    Optional<SessionControlEvent> findByIdAndSessionId(Long id, Long sessionId);

    /** 종료 후 분석용. 실제 적용된(APPLIED) PAUSE·RESUME을 적용시각 순으로 읽는다. 같은 시각이면 먼저 만든 명령이 앞선다. */
    List<SessionControlEvent> findBySessionIdAndActionInAndResultOrderByAppliedAtAscIdAsc(
            Long sessionId, Collection<ControlAction> actions, ControlResult result);

    boolean existsBySessionIdAndActionAndResultIn(
            Long sessionId, ControlAction action, Collection<ControlResult> results);
}
