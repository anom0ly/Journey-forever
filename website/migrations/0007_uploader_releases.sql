-- Uploader builds an admin approved on the Uploaders page. The uploader
-- updates itself only to the newest approved build, and only when the file
-- on GitHub has exactly this SHA-256, so a release that reached GitHub some
-- other way (another workflow, a replaced file) is never installed.
-- Withdrawing an approval deletes its row.
CREATE TABLE uploader_releases (
  version TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  approved_at INTEGER NOT NULL,
  approved_by TEXT NOT NULL          -- the admin's user id
);
