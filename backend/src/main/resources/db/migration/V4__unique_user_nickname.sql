-- Existing duplicate nicknames fail atomically; no automatic rename or deletion.
ALTER TABLE "users" ADD CONSTRAINT "uq_users_nickname" UNIQUE ("nickname");
