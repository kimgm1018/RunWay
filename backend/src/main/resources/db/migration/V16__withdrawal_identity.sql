-- S15P31E105-248: retain required columns; retire login IDs as SHA-256 digests.
ALTER TABLE users ALTER COLUMN login_id TYPE varchar(64);
ALTER TABLE users DROP CONSTRAINT uq_users_nickname;
CREATE UNIQUE INDEX uq_users_nickname ON users(nickname) WHERE account_status='ACTIVE';
