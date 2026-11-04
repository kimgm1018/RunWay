-- S15P31E105-255 running session S01. One active (READY/RUNNING/PAUSED, state_version >= 1, not deleted)
-- session per user. Legacy records (state_version = 0) are excluded. Backs up the per-user advisory lock so
-- any other path that creates or reactivates a session cannot leave two active sessions.
-- Fails without changing data if a user already has two active sessions.
CREATE UNIQUE INDEX uq_running_sessions_active ON running_sessions(user_id)
    WHERE status IN ('READY','RUNNING','PAUSED') AND state_version >= 1 AND deleted_at IS NULL;
