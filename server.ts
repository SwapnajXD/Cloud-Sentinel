require('dotenv').config();
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import * as bcrypt from 'bcryptjs';
import { Pool, QueryResult } from 'pg';
import { createClient } from 'redis';
import cors from 'cors';

import { signToken, authenticateJWT, TokenPayload } from './lib/auth';

const PORT = process.env.PORT || 3000;

const app: Express = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json());
app.use(morgan('combined'));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || false }));

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Postgres pool
const pool: Pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

// Redis client
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err: Error) => console.error('Redis Client Error', err));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPostgres(maxAttempts: number = 30, delayMs: number = 2000): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      lastError = err as Error;
      console.warn(`Postgres not ready yet (attempt ${attempt}/${maxAttempts})`);
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

async function start(): Promise<void> {
  try {
    await waitForPostgres();
    await initDb();
    await redisClient.connect();

    app.listen(PORT, () => {
      console.log(`Cloud-Sentinel Gateway listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

interface User {
  id: number;
  email: string;
}

interface UserFromDb extends User {
  password: string;
}

async function findUserByEmail(email: string): Promise<UserFromDb | undefined> {
  const res: QueryResult<UserFromDb> = await pool.query(
    'SELECT id, email, password FROM users WHERE email = $1',
    [email]
  );
  return res.rows[0];
}

// Routes
app.post('/api/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'email and password required' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'password too short' });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const result: QueryResult<User> = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );
    const user: User = result.rows[0];
    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    if ((err as any).code === '23505') {
      res.status(409).json({ error: 'email already registered' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

app.post('/api/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'email and password required' });
      return;
    }

    const user: UserFromDb | undefined = await findUserByEmail(email);
    if (!user) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    const ok: boolean = await bcrypt.compare(password, user.password);
    if (!ok) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }

    const token: string = signToken({ id: user.id, email: user.email });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Audit endpoint: push a task to Redis list
app.post('/api/audit', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as TokenPayload;
    const task = {
      action: 'start_audit',
      user_id: user.id,
      requested_at: new Date().toISOString(),
      params: req.body.params || {},
    };
    await redisClient.lPush('audit_tasks', JSON.stringify(task));
    res.status(202).json({ status: 'queued' });
  } catch (err) {
    console.error('Failed to queue audit task', err);
    res.status(500).json({ error: 'failed to queue task' });
  }
});

// Health
app.get('/health', (req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  try {
    await redisClient.disconnect();
  } catch (e) {}
  try {
    await pool.end();
  } catch (e) {}
  process.exit(0);
});

start();
