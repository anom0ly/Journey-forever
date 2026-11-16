-- Automatic checks open review items too. seen_checks is the JSON list of
-- check lines that were on the item when it was last cleared; only a line
-- not in it opens the item again. checks_opened_at is when a check last
-- opened it.
ALTER TABLE flags ADD COLUMN seen_checks TEXT;
ALTER TABLE flags ADD COLUMN checks_opened_at INTEGER;

-- Public characters that already have check lines: their items open now
-- (nothing has been seen yet).
UPDATE flags SET status = 'open', opened_at = unixepoch(), updated_at = unixepoch(), checks_opened_at = unixepoch()
WHERE status = 'cleared' AND EXISTS (
  SELECT 1 FROM characters c WHERE c.user_id = flags.user_id AND c.key = flags.char_key AND c.checks IS NOT NULL AND c.is_public = 1);
INSERT OR IGNORE INTO flags (user_id, char_key, status, opened_at, updated_at, checks_opened_at)
SELECT user_id, key, 'open', unixepoch(), unixepoch(), unixepoch() FROM characters WHERE checks IS NOT NULL AND is_public = 1;
