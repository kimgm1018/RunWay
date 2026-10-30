-- S15P31E105-173 online MVP. V1 and V2 are immutable; this V3 adds the session control contract.
LOCK TABLE running_sessions IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM running_sessions WHERE status IN ('RUNNING','PAUSED')) THEN
        RAISE EXCEPTION 'V3 requires active V1 sessions to finish through the old protocol first';
    END IF;
END;
$$;
CREATE TYPE "running_sessions_analysis_status_enum" AS ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED', 'LEGACY');
CREATE TYPE "session_control_events_action_enum" AS ENUM('START', 'PAUSE', 'RESUME', 'END', 'SET_BPM', 'COACHING');
CREATE TYPE "session_control_events_result_enum" AS ENUM('PENDING', 'APPLIED', 'REJECTED', 'IGNORED', 'UNKNOWN');
ALTER TABLE running_sessions
    ADD COLUMN "control_device_id" BIGINT NULL,
    ADD COLUMN "relay_device_id" BIGINT NULL,
    ADD COLUMN "state_version" BIGINT DEFAULT 0 NOT NULL CHECK (state_version >= 0),
    ADD COLUMN "current_bpm" INTEGER NULL CHECK (current_bpm BETWEEN 60 AND 220),
    ADD COLUMN "analysis_status" "running_sessions_analysis_status_enum" DEFAULT 'PENDING' NOT NULL;
ALTER TABLE coaching_decisions
    ADD COLUMN "based_on_state_version" BIGINT NULL,
    ADD COLUMN "expires_at" TIMESTAMPTZ NULL;

-- 173 온라인 MVP: 현재 상태 저장, 최소한의 명령 결과 기록, 오래된 코칭 적용 방지.
ALTER TABLE running_sessions ADD CONSTRAINT fk_session_control_device
    FOREIGN KEY (control_device_id) REFERENCES user_devices(id);
ALTER TABLE running_sessions ADD CONSTRAINT fk_session_relay_device
    FOREIGN KEY (relay_device_id) REFERENCES user_devices(id);
ALTER TABLE running_sessions ADD CONSTRAINT ck_session_protocol_active
    CHECK (state_version > 0 OR status NOT IN ('RUNNING','PAUSED'));
ALTER TABLE coaching_decisions ADD CONSTRAINT ck_coaching_context CHECK (
    (based_on_state_version IS NULL AND expires_at IS NULL)
    OR (based_on_state_version IS NOT NULL AND based_on_state_version >= 1
        AND expires_at IS NOT NULL AND created_at < expires_at
        AND expires_at <= created_at + INTERVAL '20 seconds'));
ALTER TABLE coaching_decisions ADD CONSTRAINT uq_coaching_session_id UNIQUE (session_id,id);

CREATE TABLE session_control_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES running_sessions(id),
    device_id BIGINT NOT NULL REFERENCES user_devices(id),
    action "session_control_events_action_enum" NOT NULL,
    target_bpm INTEGER NULL CHECK (target_bpm BETWEEN 60 AND 220),
    expected_version BIGINT NOT NULL CHECK (expected_version >= 1),
    coaching_id BIGINT NULL,
    result "session_control_events_result_enum" DEFAULT 'PENDING' NOT NULL,
    applied_at TIMESTAMPTZ NULL,
    reason_code VARCHAR(64) NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_control_version UNIQUE (session_id,expected_version),
    CONSTRAINT uq_control_coaching UNIQUE (session_id,coaching_id),
    CONSTRAINT fk_control_coaching FOREIGN KEY (session_id,coaching_id) REFERENCES coaching_decisions(session_id,id),
    CONSTRAINT ck_control_coaching CHECK ((action = 'COACHING') = (coaching_id IS NOT NULL)),
    CONSTRAINT ck_control_target CHECK ((action IN ('SET_BPM','COACHING')) = (target_bpm IS NOT NULL)),
    CONSTRAINT ck_control_result CHECK ((result = 'APPLIED') = (applied_at IS NOT NULL)),
    CONSTRAINT ck_control_ignored CHECK (result <> 'IGNORED' OR action = 'COACHING')
);
CREATE UNIQUE INDEX uq_control_pending ON session_control_events(session_id,device_id)
    WHERE result IN ('PENDING','UNKNOWN');
CREATE INDEX ix_control_session_time ON session_control_events(session_id,created_at);

-- Old rows preserve their recorded results and cannot reactivate the old protocol.
UPDATE running_sessions SET analysis_status='LEGACY' WHERE state_version=0;
ALTER TABLE running_sessions ALTER COLUMN state_version SET DEFAULT 1;

-- Preserve batch identifiers; invalid legacy UUIDs abort the entire migration.
ALTER TABLE sync_batches ALTER COLUMN client_batch_id TYPE UUID USING client_batch_id::uuid;
