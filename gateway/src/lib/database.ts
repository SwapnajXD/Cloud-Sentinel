import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [727001]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const directory = resolve(__dirname, '../../migrations');
    for (const version of readdirSync(directory).filter(f => f.endsWith('.sql')).sort()) {
      const applied = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [version]);
      if (!applied.rowCount) {
        await client.query(readFileSync(resolve(directory, version), 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
