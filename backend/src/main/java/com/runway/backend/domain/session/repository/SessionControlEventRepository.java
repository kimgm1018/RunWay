package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.entity.SessionControlEvent;
import java.util.Collection;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SessionControlEventRepository extends JpaRepository<SessionControlEvent, Long> {

    /** uq_control_pending으로 세션·기기별 미확정 명령은 최대 하나다. */
    Optional<SessionControlEvent> findFirstBySessionIdAndDeviceIdAndResultIn(
            Long sessionId, Long deviceId, Collection<ControlResult> results);

    Optional<SessionControlEvent> findFirstBySessionIdOrderByIdDesc(Long sessionId);

    boolean existsBySessionIdAndActionAndResultIn(
            Long sessionId, ControlAction action, Collection<ControlResult> results);
}
