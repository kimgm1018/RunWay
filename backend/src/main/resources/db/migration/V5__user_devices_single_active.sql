-- S15P31E105-251 device registration. One linked (unlinked_at IS NULL) device per user and type.
-- Fails without changing data if a user already has two linked devices of the same type.
CREATE UNIQUE INDEX uq_user_devices_active ON user_devices(user_id,device_type)
    WHERE unlinked_at IS NULL;
