ALTER TABLE worker_heartbeats
  ADD COLUMN IF NOT EXISTS aws_credentials_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS aws_credentials_error TEXT,
  ADD COLUMN IF NOT EXISTS aws_credentials_checked_at TIMESTAMPTZ;

ALTER TABLE worker_heartbeats
  ADD CONSTRAINT worker_aws_credentials_status_check
  CHECK (aws_credentials_status IN ('unknown','ready','expired','invalid','missing','unavailable'));

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_updated
  ON worker_heartbeats(updated_at DESC);
