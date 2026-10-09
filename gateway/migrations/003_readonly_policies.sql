CREATE TABLE IF NOT EXISTS policies (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  description TEXT NOT NULL DEFAULT '',
  source_yaml TEXT NOT NULL,
  document JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name, version)
);
CREATE INDEX IF NOT EXISTS idx_policies_owner ON policies(user_id, name, version DESC);
