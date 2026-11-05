-- S15P31E105-421. PostgreSQL does not index foreign keys automatically, and running_metric_samples has no
-- running_session_id index. Supports per-session lookups by elapsed time: the AI04 live-coaching history window
-- (max elapsed_duration, then recent rows in elapsed order), which runs every 15 seconds per running session.
-- Table structure and data are unchanged.
CREATE INDEX idx_running_metric_samples_session_elapsed
    ON running_metric_samples (running_session_id, elapsed_duration);
