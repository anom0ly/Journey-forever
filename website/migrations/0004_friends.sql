-- Battle.net friends (lib/friends.ts). Only hashes of BattleTags are kept.

-- The hash of the user's own BattleTag, to match against friends' lists.
ALTER TABLE users ADD COLUMN tag_hash TEXT;
CREATE INDEX users_tag_hash ON users(tag_hash);
-- 1 when the user turned off "Show me to my Battle.net friends".
ALTER TABLE users ADD COLUMN friends_hidden INTEGER NOT NULL DEFAULT 0;
-- When the user's friends list was last uploaded.
ALTER TABLE users ADD COLUMN friends_at INTEGER;

-- One row per friend per list: "jf" (our addon) or "rts" (Road to Sixty).
-- An upload that includes a list replaces that list.
CREATE TABLE friend_tags (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  tag_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, source, tag_hash)
);
CREATE INDEX friend_tags_hash ON friend_tags(tag_hash);
