-- Accounts signed in with Battle.net (or the local dev user).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  bnet_id TEXT UNIQUE,
  battletag TEXT,
  created_at INTEGER NOT NULL,
  last_upload_at INTEGER
);

-- Sign-in sessions; id is the SHA-256 of the cookie's token.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One row per character; the journey itself is in R2 (journeys/<user>/<key>.json.gz).
CREATE TABLE characters (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  realm TEXT NOT NULL,
  summary TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  slug TEXT UNIQUE,
  journey_size INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Screenshots; the images are in R2 (shots/<user>/<id>.jpg and .thumb.jpg).
-- id is derived from the image's bytes, so uploading a shot twice keeps one.
CREATE TABLE screenshots (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  char_key TEXT NOT NULL,
  t INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  file TEXT,
  width INTEGER,
  height INTEGER,
  size INTEGER,
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX screenshots_char ON screenshots(user_id, char_key, t);
