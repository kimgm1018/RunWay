ALTER TABLE running_sessions ADD COLUMN phone_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE running_sessions ADD CONSTRAINT ck_phone_only_control
    CHECK (NOT phone_only OR (control_device_id IS NOT NULL AND control_device_id = relay_device_id));
