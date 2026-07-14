require('dotenv').config();

import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import * as bcrypt from 'bcryptjs';
import { Pool, QueryResult } from 'pg';
import { createClient } from 'redis';
import cors from 'cors';
import { randomUUID } from 'crypto';

import { signToken, authenticateJWT, TokenPayload } from './lib/auth';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export const app: Express = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json());
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}
// Allow a comma-separated list of origins via ALLOWED_ORIGIN (e.g.
// "http://localhost:3001,https://app.example.com"). Falls back to permissive
// CORS only outside production, so a missing env var can't silently open
// things up in prod.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin:
      allowedOrigins.length > 0
        ? allowedOrigins
        : process.env.NODE_ENV === 'production'
        ? false // no ALLOWED_ORIGIN configured in prod -> block cross-origin by default
        : true, // permissive only for local dev
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Tighter limiter specifically for auth endpoints to slow down credential
// stuffing / brute force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts, try again later' },
});

// Postgres
export const pool: Pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis
export const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis error:', err));

// Helpers
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPostgres(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      console.warn(`Waiting for Postgres (${i + 1}/30)...`);
      await sleep(2000);
    }
  }
  throw new Error('Postgres not reachable');
}

// DB Init
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      report JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reports ON audit_reports(user_id, created_at DESC)
  `);

  // Tracks the lifecycle of a queued audit (queued -> running -> done/error)
  // so the dashboard can show real progress instead of blindly polling
  // /api/reports and hoping something new shows up.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_tasks (
      task_id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      mode TEXT NOT NULL DEFAULT 'aws',
      report_id INTEGER REFERENCES audit_reports(id) ON DELETE SET NULL,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_tasks_user ON audit_tasks(user_id, created_at DESC)
  `);

  // Recurring scans: a schedule is checked by the worker's background
  // scheduler loop and turned into a normal audit_tasks row + Redis push
  // when it comes due, exactly like a manually-triggered scan.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_scans (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'aws',
      interval_hours INTEGER NOT NULL,
      next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_scans_user ON scheduled_scans(user_id, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_scheduled_scans_due ON scheduled_scans(next_run_at)
  `);
}

// Types
interface User {
  id: number;
  email: string;
}

interface UserFromDb extends User {
  password: string;
}

// DB helper
async function findUserByEmail(email: string): Promise<UserFromDb | undefined> {
  const res: QueryResult<UserFromDb> = await pool.query(
    'SELECT id, email, password FROM users WHERE email = $1',
    [email]
  );
  return res.rows[0];
}

// ROUTES

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/register', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'invalid email format' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'weak password' });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'email exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    const token = signToken({ id: user.id, email: user.email });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'server error' });
  }
});

// Queue audit
app.post('/api/audit', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    // ✅ NEW: accept mode from frontend
    const mode = req.body.mode === "floci" ? "floci" : "aws";
    const task_id = randomUUID();

    const task = {
      task_id,
      action: 'start_audit',
      user_id: user.id,
      requested_at: new Date().toISOString(),
      mode, // ✅ IMPORTANT
      params: req.body.params || {},
    };

    await pool.query(
      'INSERT INTO audit_tasks (task_id, user_id, status, mode) VALUES ($1, $2, $3, $4)',
      [task_id, user.id, 'queued', mode]
    );

    await redisClient.lPush('audit_tasks', JSON.stringify(task));

    res.status(202).json({ status: 'queued', mode, task_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'queue failed' });
  }
});

// Check the status of a previously queued audit
app.get('/api/audit/:task_id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const result = await pool.query(
      `SELECT task_id, status, mode, report_id, error, created_at, updated_at
       FROM audit_tasks WHERE task_id = $1 AND user_id = $2`,
      [req.params.task_id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'task not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'error fetching task status' });
  }
});

// Reports
app.get('/api/reports', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 500);

    const result = await pool.query(
      'SELECT id, report, created_at FROM audit_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [user.id, limit]
    );

    res.json({ reports: result.rows });
  } catch {
    res.status(500).json({ error: 'error fetching reports' });
  }
});

// Delete account (password-confirmed). Reports are removed automatically via
// the ON DELETE CASCADE foreign key on audit_reports.user_id.
app.delete('/api/account', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'password required to confirm deletion' });
    }

    const dbUser = await findUserByEmail(user.email);
    if (!dbUser) {
      return res.status(404).json({ error: 'account not found' });
    }

    const ok = await bcrypt.compare(password, dbUser.password);
    if (!ok) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'account deletion failed' });
  }
});

// AI summary (fixed API key handling)
app.post('/api/ai/summary', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const { report } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!report) return res.status(400).json({ error: 'report required' });
    if (!apiKey) return res.status(500).json({ error: 'no api key' });

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: JSON.stringify(report) }] }],
        }),
      }
    );

    const data: any = await response.json();
    const summary =
      data.candidates?.[0]?.content?.parts?.[0]?.text || 'No summary generated';

    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ai failed' });
  }
});

// Recurring scans
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 168; // 1 week - keep it sane for a homelab-scale tool

app.post('/api/schedules', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const mode = req.body.mode === 'floci' ? 'floci' : 'aws';
    const intervalHours = Number(req.body.interval_hours);

    if (
      !Number.isInteger(intervalHours) ||
      intervalHours < MIN_INTERVAL_HOURS ||
      intervalHours > MAX_INTERVAL_HOURS
    ) {
      return res.status(400).json({
        error: `interval_hours must be an integer between ${MIN_INTERVAL_HOURS} and ${MAX_INTERVAL_HOURS}`,
      });
    }

    const result = await pool.query(
      `INSERT INTO scheduled_scans (user_id, mode, interval_hours, next_run_at)
       VALUES ($1, $2, $3, NOW() + make_interval(hours => $3))
       RETURNING id, mode, interval_hours, next_run_at, created_at`,
      [user.id, mode, intervalHours]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to create schedule' });
  }
});

app.get('/api/schedules', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const result = await pool.query(
      `SELECT id, mode, interval_hours, next_run_at, created_at
       FROM scheduled_scans WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id]
    );
    res.json({ schedules: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to fetch schedules' });
  }
});

app.delete('/api/schedules/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const result = await pool.query(
      'DELETE FROM scheduled_scans WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'schedule not found' });
    }

    res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to delete schedule' });
  }
});

// Dead-letter queue: tasks that exhausted every retry. Only returns (and
// only lets you dismiss) entries belonging to the caller - the queue itself
// has no per-user separation in Redis, so we filter/rebuild it here.
const DEAD_LETTER_QUEUE = 'audit_tasks_dead';

app.get('/api/dead-letter', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    // Bounded read: this is meant for "a handful of failed scans to review",
    // not an unbounded audit log.
    const raw = await redisClient.lRange(DEAD_LETTER_QUEUE, 0, 199);

    const tasks = raw
      .map((entry) => {
        try {
          return JSON.parse(entry);
        } catch {
          return null;
        }
      })
      .filter((t) => t && t.user_id === user.id);

    res.json({ tasks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'error fetching dead-letter queue' });
  }
});

app.delete('/api/dead-letter/:task_id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const raw = await redisClient.lRange(DEAD_LETTER_QUEUE, 0, -1);

    let removed = false;
    const remaining = raw.filter((entry) => {
      let parsed: any;
      try {
        parsed = JSON.parse(entry);
      } catch {
        return true; // keep anything we can't parse rather than silently dropping it
      }
      const isMatch = parsed.task_id === req.params.task_id && parsed.user_id === user.id;
      if (isMatch) removed = true;
      return !isMatch;
    });

    if (!removed) {
      return res.status(404).json({ error: 'not found' });
    }

    const multi = redisClient.multi();
    multi.del(DEAD_LETTER_QUEUE);
    if (remaining.length > 0) {
      multi.rPush(DEAD_LETTER_QUEUE, remaining);
    }
    await multi.exec();

    res.json({ status: 'success' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'error dismissing dead-letter task' });
  }
});

// Health
app.get('/health', async (req: Request, res: Response) => {
  const checks = { postgres: 'ok', redis: 'ok' };

  try {
    await pool.query('SELECT 1');
  } catch {
    (checks as any).postgres = 'error';
  }

  try {
    await redisClient.ping();
  } catch {
    (checks as any).redis = 'error';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: process.uptime(),
    checks,
  });
});
