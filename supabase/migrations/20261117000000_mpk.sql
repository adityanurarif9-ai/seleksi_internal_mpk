BEGIN;

CREATE SCHEMA IF NOT EXISTS mpk;
REVOKE ALL ON SCHEMA mpk FROM PUBLIC;

CREATE TABLE IF NOT EXISTS mpk.users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('participant', 'admin')),
  cohort TEXT CHECK (cohort IN ('X', 'XI'))
);
CREATE TABLE IF NOT EXISTS mpk.sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES mpk.users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON mpk.sessions(expires);
CREATE TABLE IF NOT EXISTS mpk.login_limits (
  key TEXT PRIMARY KEY,
  "window" BIGINT NOT NULL,
  hits INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mpk.questions (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  position BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS mpk.settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  duration INTEGER NOT NULL,
  is_open INTEGER NOT NULL
);
INSERT INTO mpk.settings VALUES (1, 45, 0) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS mpk.attempts (
  user_id TEXT PRIMARY KEY REFERENCES mpk.users(id),
  snapshot TEXT NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  started BIGINT NOT NULL,
  deadline BIGINT NOT NULL,
  submitted BIGINT,
  review TEXT
);
CREATE TABLE IF NOT EXISTS mpk.violations (
  user_id TEXT NOT NULL REFERENCES mpk.attempts(user_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tab-hidden', 'fullscreen-exit')),
  occurred_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS violations_by_time ON mpk.violations (user_id, occurred_at);

COMMIT;
