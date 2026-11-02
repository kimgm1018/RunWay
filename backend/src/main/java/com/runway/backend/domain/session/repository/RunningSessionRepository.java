package com.runway.backend.domain.session.repository;

import com.runway.backend.domain.session.entity.RunningSession;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RunningSessionRepository extends JpaRepository<RunningSession, Long> {

    /** 상태 변경·삭제는 세션 행 잠금으로 순서를 정한다. 그룹 연결 세션은 호출 전에 그룹 행을 먼저 잠근다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from RunningSession s where s.id = :id")
    Optional<RunningSession> findByIdForUpdate(@Param("id") long id);

    /** 활성 세션 검사. 기존 기록(state_version=0)은 제외한다. */
    @Query(
            value =
                    """
                    SELECT id FROM running_sessions
                    WHERE user_id = :userId AND state_version >= 1
                      AND status IN ('READY','RUNNING','PAUSED') AND deleted_at IS NULL
                    ORDER BY id LIMIT 1
                    """,
            nativeQuery = true)
    Optional<Long> findActiveSessionId(@Param("userId") long userId);
}
