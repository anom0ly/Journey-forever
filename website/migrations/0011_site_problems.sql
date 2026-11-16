-- Problems the site hears about (lib/problems.ts): the pages' error reports,
-- sign-in failures and the errors our addon caught in game. The same problem
-- is one group, so the admin Problems page shows it once with everyone who
-- hit it. Reports are also logged for Workers Issues, as before.
CREATE TABLE problem_groups (
  id TEXT PRIMARY KEY,               -- hash of the group key
  kind TEXT NOT NULL,                -- upload, signin, page, load, boards, addon
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open, fixed, hidden
  first_t INTEGER NOT NULL,
  last_t INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  fixed_at INTEGER,
  note TEXT,                         -- what affected players were told when it was fixed
  updated_by TEXT
);
CREATE INDEX problem_groups_status ON problem_groups(status, last_t);

-- Each time it happened, kept 30 days and at most 20 per account. detail is
-- the cleaned report as JSON (never a file's contents).
CREATE TABLE site_problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES problem_groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX site_problems_group ON site_problems(group_id, t);
CREATE INDEX site_problems_user ON site_problems(user_id, t);
CREATE INDEX site_problems_t ON site_problems(t);

-- "Fixed" notes waiting for a player who hit the problem, shown on their next
-- visit until they dismiss it.
CREATE TABLE problem_notices (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES problem_groups(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  note TEXT NOT NULL,
  hit_at INTEGER NOT NULL,           -- when they last hit it
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id)
);
