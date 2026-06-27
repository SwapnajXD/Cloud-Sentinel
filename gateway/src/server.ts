require('dotenv').config();

import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import * as bcrypt from 'bcryptjs';
import { Pool, QueryResult } from 'pg';
import { createClient } from 'redis';
import cors from 'cors';

import { signToken, authenticateJWT, TokenPayload } from './lib/auth';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

const PORT = process.env.PORT || 3000;

const app: Express = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json());
app.use(morgan('combined'));
app.use(
  cors({
    origin: "http://localhost:3001",
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

// Postgres
const pool: Pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis error:', err));

// Helpers
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPostgres(): Promise<void> {
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
async function initDb(): Promise<void> {
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
}

// Start server
async function start(): Promise<void> {
  try {
    await waitForPostgres();
    await initDb();

    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    app.listen(PORT, () => {
      console.log(`Cloud-Sentinel running on port ${PORT}`);
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
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

app.post('/api/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    if (password.length < 8) {
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

app.post('/api/login', async (req: Request, res: Response) => {
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

    const task = {
      action: 'start_audit',
      user_id: user.id,
      requested_at: new Date().toISOString(),
      params: req.body.params || {},
    };

    await redisClient.lPush('audit_tasks', JSON.stringify(task));

    res.status(202).json({ status: 'queued' });
  } catch (err) {
    res.status(500).json({ error: 'queue failed' });
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

// ✅ FIXED HEALTH ENDPOINT
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

// Shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await redisClient.disconnect();
  await pool.end();
  process.exit(0);
});

start();
