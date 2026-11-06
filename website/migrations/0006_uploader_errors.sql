-- Problems the Windows uploader reports (POST /api/errors, kind "uploader"),
-- cleaned of names and paths before they're sent and again before they're
-- stored. The last 10 per PC, for the admin Uploader health page; every
-- report is also logged for Workers Issues.
CREATE TABLE upload_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL REFERENCES upload_keys(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  area TEXT NOT NULL,                -- crash, upload, read, addon, update, window
  message TEXT NOT NULL,
  app_version TEXT
);
CREATE INDEX upload_errors_key ON upload_errors(key_id, t);

-- Windows version the PC last reported, for the health page.
ALTER TABLE upload_keys ADD COLUMN os_version TEXT;
