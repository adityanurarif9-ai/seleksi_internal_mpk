ALTER TABLE users ADD COLUMN cohort TEXT CHECK (cohort IN ('X', 'XI'));
UPDATE users SET cohort = CASE
  WHEN upper(trim(class)) || ' ' LIKE 'XI %' OR upper(trim(class)) || ' ' LIKE '11 %' THEN 'XI'
  WHEN upper(trim(class)) || ' ' LIKE 'X %' OR upper(trim(class)) || ' ' LIKE '10 %' THEN 'X'
END WHERE role = 'participant';
CREATE TABLE violations (
  user_id TEXT NOT NULL REFERENCES attempts(user_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tab-hidden', 'fullscreen-exit')),
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX violations_by_time ON violations (user_id, occurred_at);
