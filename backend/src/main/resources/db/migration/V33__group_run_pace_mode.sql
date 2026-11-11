-- S15P31E105-680. Host-selected group pace mode and the start calculation's basis.
ALTER TABLE group_run_pace_state
    ADD COLUMN pace_mode VARCHAR(8) NOT NULL DEFAULT 'TOGETHER'
        CHECK (pace_mode IN ('TOGETHER', 'GOAL')),
    ADD COLUMN ai_recommended_pace_sec_per_km INTEGER
        CHECK (ai_recommended_pace_sec_per_km > 0),
    ADD COLUMN pace_basis_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN slower_than_goal_count INTEGER CHECK (slower_than_goal_count >= 0),
    ADD COLUMN start_requested_at TIMESTAMPTZ;
