-- Friends privacy (security review Nov 17, findings 1 and 7). Stored friend
-- hashes are now keyed on the server with the FRIENDS_KEY secret, so they
-- can't be worked out from a BattleTag anywhere else (worker/friends.ts).
-- New names, so this is safe to apply before or after the new code deploys:
-- the old code keeps using friend_tags and users.tag_hash until then.

-- Keyed lists, one row per friend per list, as friend_tags was.
CREATE TABLE friend_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  tag_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, source, tag_hash)
);
CREATE INDEX friend_keys_hash ON friend_keys(tag_hash);

-- The user's own BattleTag, keyed the same way. The Worker fills it on
-- first need and clears the old plain users.tag_hash as it goes; it also
-- moves friend_tags rows into friend_keys a batch at a time, so nobody's
-- highlights go blank. Both old names can be dropped once they're empty.
ALTER TABLE users ADD COLUMN tag_key TEXT;
CREATE INDEX users_tag_key ON users(tag_key);

-- Friends-list changes per day (at most 10): the UTC day number and the count.
ALTER TABLE users ADD COLUMN friends_day INTEGER;
ALTER TABLE users ADD COLUMN friends_changes INTEGER NOT NULL DEFAULT 0;
