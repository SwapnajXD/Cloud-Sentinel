-- Fail safely on invalid legacy data. Do not delete or silently reassign it.
DO $$
DECLARE t TEXT; c TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','audit_reports','audit_tasks','scheduled_scans','aws_connections'] LOOP
    FOR c IN SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND data_type = 'timestamp without time zone'
    LOOP
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''', t, c, c);
    END LOOP;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at SET NOT NULL', t);
    IF t <> 'users' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN user_id SET NOT NULL', t);
      -- Replace legacy FK definitions consistently, including worker-created tables.
      FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid = t::regclass AND contype = 'f' AND confrelid = 'users'::regclass
      LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, c);
      END LOOP;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE', t, t || '_user_id_fkey');
    END IF;
  END LOOP;
END $$;
ALTER TABLE audit_reports ALTER COLUMN report SET NOT NULL;
ALTER TABLE audit_tasks ALTER COLUMN updated_at SET NOT NULL;
-- A database invariant, not a check-then-insert promise. Existing multi-user
-- databases must be reviewed by their owner before this migration can run.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner ON users ((true));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized ON users (lower(email));
ALTER TABLE aws_connections ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE aws_connections ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'us-east-1';
ALTER TABLE audit_tasks ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}';
ALTER TABLE audit_tasks ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_tasks ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE audit_tasks ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
ALTER TABLE audit_tasks ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE audit_tasks ADD COLUMN IF NOT EXISTS progress TEXT NOT NULL DEFAULT 'Waiting for worker';
ALTER TABLE audit_tasks ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE audit_tasks ADD CONSTRAINT audit_tasks_status_check CHECK (status IN ('queued','running','done','partial','error'));
ALTER TABLE audit_tasks ADD CONSTRAINT audit_tasks_mode_check CHECK (mode IN ('aws','floci'));
ALTER TABLE audit_tasks ADD CONSTRAINT audit_tasks_attempts_check CHECK (attempts >= 0);
ALTER TABLE audit_reports ADD COLUMN IF NOT EXISTS task_id TEXT UNIQUE REFERENCES audit_tasks(task_id) ON DELETE SET NULL;
ALTER TABLE scheduled_scans ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE scheduled_scans ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'us-east-1';
ALTER TABLE scheduled_scans ADD COLUMN IF NOT EXISTS services JSONB NOT NULL DEFAULT '["s3","ec2","iam","rds","lambda"]';
ALTER TABLE scheduled_scans ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
ALTER TABLE scheduled_scans ADD COLUMN IF NOT EXISTS last_task_id TEXT REFERENCES audit_tasks(task_id) ON DELETE SET NULL;
ALTER TABLE scheduled_scans ADD CONSTRAINT scheduled_interval_check CHECK (interval_hours BETWEEN 1 AND 168);
ALTER TABLE scheduled_scans ADD CONSTRAINT scheduled_mode_check CHECK (mode IN ('aws','floci'));
UPDATE audit_tasks SET payload = jsonb_build_object(
  'task_id', task_id, 'user_id', user_id, 'action', 'start_audit',
  'mode', mode, 'connection_id', connection_id, 'requested_at', created_at,
  'params', jsonb_build_object('scope', 'default')) WHERE payload = '{}';
-- A pre-upgrade running process has no renewable lease; recover it immediately.
UPDATE audit_tasks SET status = 'queued', lease_until = NULL WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_reports ON audit_reports(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tasks_user ON audit_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_dispatch ON audit_tasks(available_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_scheduled_scans_due ON scheduled_scans(next_run_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
