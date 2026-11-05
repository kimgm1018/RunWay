-- S15P31E105-409. PostgreSQL does not index foreign keys automatically, and the only user_id index on
-- running_sessions is the active-session partial index (V8). Supports per-user lookups of completed runs by
-- most recent ended_at (e.g. AI09 pace calibration, AI04 BPM history). Table structure and data are unchanged.
CREATE INDEX idx_running_sessions_user_ended ON running_sessions (user_id, ended_at DESC);
