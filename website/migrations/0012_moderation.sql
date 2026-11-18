-- A reviewer's Hide, kept apart from the character so deleting the
-- character (or the account) and uploading it again doesn't undo it.
-- A character coming back matches by its key (the game's GUID) or by
-- name + realm, on any account. Only clearing it on the review page
-- removes the row.
CREATE TABLE moderation (
  user_id TEXT NOT NULL,
  char_key TEXT NOT NULL,
  name TEXT NOT NULL,
  realm TEXT NOT NULL,
  hidden_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, char_key)
);
CREATE INDEX moderation_key ON moderation(char_key);
CREATE INDEX moderation_name ON moderation(lower(name), lower(realm));

-- Today's Hides.
INSERT OR IGNORE INTO moderation (user_id, char_key, name, realm, hidden_at)
SELECT f.user_id, f.char_key, c.name, c.realm, f.updated_at
FROM flags f JOIN characters c ON c.user_id = f.user_id AND c.key = f.char_key
WHERE f.status = 'hidden';

-- Thumbnail bytes, so they count toward an account's storage. Thumbnails
-- sent before this stay NULL (counted as 0); they're small.
ALTER TABLE screenshots ADD COLUMN thumb_size INTEGER;
