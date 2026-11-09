-- S15P31E105-585. Null pace means no successful inference yet.
CREATE TABLE group_run_pace_state (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_run_id BIGINT NOT NULL UNIQUE REFERENCES group_runs(id) ON DELETE CASCADE,
    group_pace_sec_per_km INTEGER CHECK (group_pace_sec_per_km > 0),
    start_recommended_pace_sec_per_km INTEGER CHECK (start_recommended_pace_sec_per_km > 0),
    last_change_direction VARCHAR(4) CHECK (last_change_direction IN ('SLOW', 'FAST')),
    last_change_at TIMESTAMPTZ,
    struggling_count INTEGER NOT NULL DEFAULT 0 CHECK (struggling_count >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((last_change_direction IS NULL) = (last_change_at IS NULL))
);
CREATE TRIGGER trg_group_run_pace_state_updated_at
    BEFORE UPDATE ON group_run_pace_state
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
