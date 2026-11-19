-- Keep MPK bounded on the shared database, with headroom for simultaneous logins.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mpk_portal') THEN
    ALTER ROLE mpk_portal CONNECTION LIMIT 24;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON mpk.sessions(user_id);
