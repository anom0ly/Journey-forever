-- Held top places (security review Nov 17, finding 3). A new time that
-- would be in the top 3 on Fastest to 60, Fastest to level N or Fastest
-- level N waits here until the reviewer approves it. The public board
-- shows the character's last approved time on that board instead, if any.
-- declined is 1 once the reviewer turned the time down: it stays waiting
-- for its owner but leaves the review page.
CREATE TABLE board_held (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  char_key TEXT NOT NULL,
  board TEXT NOT NULL,
  param TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  score REAL NOT NULL,
  declined INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, char_key, board, param)
);
CREATE INDEX board_held_board ON board_held(board, param, score);

-- The reviewer's decisions per character and board. A time at or above
-- approved is listed without asking again; a time at or above declined
-- waits quietly. Lower is better on every held board.
CREATE TABLE board_approvals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  char_key TEXT NOT NULL,
  board TEXT NOT NULL,
  param TEXT NOT NULL DEFAULT '',
  approved REAL,
  declined REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, char_key, board, param)
);

-- Every time on those boards today counts as approved.
INSERT OR IGNORE INTO board_approvals (user_id, char_key, board, param, approved, updated_at)
SELECT user_id, char_key, board, param, value, unixepoch() FROM board_entries WHERE board IN ('to60', 'tolevel', 'levelfast');

-- When the site first saw the character, for the "established reporter"
-- rule (instead of the played time the reporter's own browser sends).
ALTER TABLE characters ADD COLUMN first_upload_at INTEGER;
UPDATE characters SET first_upload_at = updated_at;
