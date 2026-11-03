-- Screenshots' public IDs (the /media/<pid> link): sha256("<user_id>:<id>"),
-- first 32 hex characters, so one account can't serve an image under another
-- account's link. Older rows get theirs when they're next listed.
ALTER TABLE screenshots ADD COLUMN pid TEXT;
CREATE UNIQUE INDEX screenshots_pid ON screenshots(pid);
