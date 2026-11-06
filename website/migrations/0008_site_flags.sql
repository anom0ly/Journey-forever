-- Switches an admin flips on the Uploaders page without a deploy:
--   uploader_beta     "1" lets every signed-in account use the uploader (else admins only)
--   uploader_connect  "0" stops new PCs connecting (admins can still connect)
--   uploader_min      a version: older uploaders can only update, not upload
-- A missing row means the default (beta off, connect on, no minimum).
CREATE TABLE site_flags (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL           -- the admin's user id
);
