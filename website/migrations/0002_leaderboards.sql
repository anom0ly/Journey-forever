-- Leaderboards (PR: leaderboards, reports and review).

-- 0 listed, 1 held off the boards (10+ reports waiting for review),
-- 2 hidden by the reviewer.
ALTER TABLE characters ADD COLUMN board_state INTEGER NOT NULL DEFAULT 0;
-- The automatic checks' findings (JSON list of sentences), for the reviewer.
ALTER TABLE characters ADD COLUMN checks TEXT;
-- Which version of the board numbers is stored (lib/boards.ts BOARDS_VERSION).
ALTER TABLE characters ADD COLUMN boards_version INTEGER;

-- One number per character per board. score is what's sorted: lower is
-- better on every board (value, or minus value), plus a tie-break below 1.
CREATE TABLE board_entries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  char_key TEXT NOT NULL,
  board TEXT NOT NULL,
  param TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (user_id, char_key, board, param)
);
CREATE INDEX board_entries_rank ON board_entries(board, param, score);

-- A report: one per reporting account per character, ever. Sending again
-- edits reason and note but keeps created_at.
CREATE TABLE reports (
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  char_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (reporter_id, user_id, char_key)
);
CREATE INDEX reports_target ON reports(user_id, char_key);
CREATE INDEX reports_by_reporter ON reports(reporter_id, created_at);

-- The review state of a reported character: open, hidden or cleared.
-- Reports made before cleared_at no longer count.
CREATE TABLE flags (
  user_id TEXT NOT NULL,
  char_key TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cleared_at INTEGER,
  PRIMARY KEY (user_id, char_key)
);

-- Accounts whose reports the reviewer chose to ignore.
CREATE TABLE ignored_reporters (
  reporter_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
