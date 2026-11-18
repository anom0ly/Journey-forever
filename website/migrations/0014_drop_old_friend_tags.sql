-- Clean-up after 0013: every friend hash was moved to friend_keys and every
-- user's own hash to users.tag_key (done in production Nov 18), so the old
-- plain-hash table and column go. The code stopped using them first.
DROP TABLE friend_tags;
DROP INDEX users_tag_hash;
ALTER TABLE users DROP COLUMN tag_hash;
