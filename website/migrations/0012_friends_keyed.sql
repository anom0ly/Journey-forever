-- Friends privacy (security review Nov 17, findings 1 and 7). Stored friend
-- hashes are now keyed on the server with the FRIENDS_KEY secret, so they
-- can't be worked out from a BattleTag anywhere else (worker/friends.ts).

-- Today's rows move here unchanged; the Worker keys them a batch at a time
-- and deletes them, so nobody's highlights go blank.
CREATE TABLE friend_tags_old AS SELECT user_id, source, tag_hash FROM friend_tags;
DELETE FROM friend_tags;
-- Users' own hashes are keyed again from their BattleTag on first need.
UPDATE users SET tag_hash = NULL;

-- Friends-list changes per day (at most 10): the UTC day number and the count.
ALTER TABLE users ADD COLUMN friends_day INTEGER;
ALTER TABLE users ADD COLUMN friends_changes INTEGER NOT NULL DEFAULT 0;
