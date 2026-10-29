CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nick          TEXT NOT NULL UNIQUE COLLATE NOCASE
                CHECK (length(nick) BETWEEN 3 AND 24),
  password_hash TEXT NOT NULL,
  avatar        TEXT,
  city          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE drinks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  brand      TEXT NOT NULL,
  volume     INTEGER,
  caffeine   INTEGER,
  sugar_free INTEGER NOT NULL DEFAULT 0 CHECK (sugar_free IN (0, 1)),
  color      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE ratings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drink_id   INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  store      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, drink_id)
);
CREATE INDEX idx_ratings_drink ON ratings(drink_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
