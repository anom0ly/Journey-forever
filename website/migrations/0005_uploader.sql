-- The Windows auto-uploader (uploader/ in the repo). Admin only for now.

-- One row per connected PC. The key itself lives only on that PC; here is
-- its SHA-256. A key can only upload (see UPLOADER_ROUTES in worker/uploader.ts).
CREATE TABLE upload_keys (
  id TEXT PRIMARY KEY,               -- shown to the page, used to disconnect
  key_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                -- the PC's name, as Windows gives it
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  last_upload_at INTEGER,
  last_ok INTEGER,                   -- 1 the last try worked, 0 it didn't
  last_message TEXT,                 -- what the last try did, or why it failed
  app_version TEXT,
  addon_version TEXT
);
CREATE INDEX upload_keys_user ON upload_keys(user_id);

-- Connect codes: made when you press Allow, handed to the uploader on your
-- PC, and swapped once for a key within 10 minutes. The swap needs the
-- secret whose hash (challenge) the uploader put in the connect link, so a
-- code is no use to anyone else.
CREATE TABLE upload_codes (
  id TEXT PRIMARY KEY,               -- SHA-256 of the code
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- The Account page's switches for the uploader, as JSON.
ALTER TABLE users ADD COLUMN uploader_settings TEXT;
