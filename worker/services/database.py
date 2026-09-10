"""Both processes apply the same versioned SQL under a transaction-scoped lock."""
import os
from pathlib import Path

SCHEMA_LOCK_KEY = 727001


def ensure_schema(conn):
    directory = Path(os.getenv('MIGRATIONS_DIR', Path(__file__).resolve().parents[2] / 'gateway' / 'migrations'))
    try:
        with conn.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(%s)', (SCHEMA_LOCK_KEY,))
            cursor.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
            for path in sorted(directory.glob('*.sql')):
                cursor.execute('SELECT version FROM schema_migrations WHERE version = %s', (path.name,))
                if cursor.fetchone() is None:
                    cursor.execute(path.read_text())
                    cursor.execute('INSERT INTO schema_migrations(version) VALUES (%s)', (path.name,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
