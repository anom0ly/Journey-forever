-- When each PC last checked in fine (an upload attempt that went well, even
-- "nothing new"). The admin Uploaders page shows "Problems" only while the
-- newest problem a PC reported is newer than this.
ALTER TABLE upload_keys ADD COLUMN last_ok_at INTEGER;
-- Until now only the last upload time was known to be good.
UPDATE upload_keys SET last_ok_at = last_upload_at WHERE last_ok = 1;
