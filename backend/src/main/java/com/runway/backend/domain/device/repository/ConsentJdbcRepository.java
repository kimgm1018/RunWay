package com.runway.backend.domain.device.repository;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * W04·W05 저장소. 건강정보 동의의 단일 원천은 {@code users.health_data_access}다. 행 잠금 순서를 직접 제어하기 위해 SQL을 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class ConsentJdbcRepository {

    private final JdbcTemplate jdbc;

    /** 로그인·프로필 저장(회원 행 FOR UPDATE)과 같은 2초 대기 상한. 초과(55P03)는 공통 처리기에서 503이다. */
    public void limitLockWait() {
        jdbc.execute("SET LOCAL lock_timeout = '2s'");
    }

    /**
     * 활성 회원의 동의 값이 다를 때만 바꾼다. 회원 행을 쓰기 잠금하므로 W06·준비도 평가의 회원 행 FOR SHARE와 서로 기다린다.
     *
     * @return 실제로 값을 바꿨으면 true. 같은 값이거나 활성 회원이 아니면 false
     */
    public boolean updateHealthConsent(long userId, boolean granted) {
        String value = granted ? "AGREE" : "DISAGREE";
        return jdbc.update(
                        """
                        UPDATE users
                        SET health_data_access = ?::users_health_data_access_enum, updated_at = now()
                        WHERE id = ? AND account_status = 'ACTIVE'
                          AND health_data_access <> ?::users_health_data_access_enum
                        """,
                        value,
                        userId,
                        value)
                > 0;
    }

    /** 잠그지 않고 활성 회원의 현재 건강정보 동의를 읽는다. 활성 회원이 아니면 빈 값. */
    public Optional<Boolean> findActiveUserConsent(long userId) {
        return jdbc
                .query(
                        "SELECT health_data_access = 'AGREE' AS consented FROM users"
                                + " WHERE id = ? AND account_status = 'ACTIVE'",
                        (rs, n) -> rs.getBoolean("consented"),
                        userId)
                .stream()
                .findFirst();
    }

    /**
     * 본인의 삭제되지 않은 진행 가능 세션(READY·RUNNING·PAUSED) 행을 FOR SHARE로 잠근다. W07은 세션 행을 FOR NO KEY UPDATE로 잡은 뒤
     * 동의를 읽으므로, 진행 중인 W07이 끝날 때까지 기다리고 이후 W07은 이 트랜잭션의 커밋을 기다렸다가 철회 값을 읽는다. W07은 이 세 상태에만 새
     * batch를 받고 종료 상태(COMPLETED·CANCELLED·INTERRUPTED)는 되돌아가지 않으므로 종료된 세션은 잠그지 않는다. 대기 중 종료로 바뀐 행은
     * PostgreSQL이 조건을 다시 평가해 제외한다. 다른 회원의 세션은 잠그지 않는다.
     */
    public void lockOwnActiveSessions(long userId) {
        jdbc.query(
                "SELECT id FROM running_sessions WHERE user_id = ? AND deleted_at IS NULL"
                        + " AND status IN ('READY', 'RUNNING', 'PAUSED') ORDER BY id FOR SHARE",
                rs -> {},
                userId);
    }
}
