require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createClient } = require('redis');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-in-prod';

const app = express();
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
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
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
redisClient.on('error', (err) => console.error('Redis Client Error', err));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPostgres(maxAttempts = 30, delayMs = 2000) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      lastError = err;
      console.warn(`Postgres not ready yet (attempt ${attempt}/${maxAttempts})`);
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

async function start() {
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

// Helpers
const { signToken, authenticateJWT } = require('./lib/auth');

async function findUserByEmail(email) {
  const res = await pool.query('SELECT id, email, password FROM users WHERE email = $1', [email]);
  return res.rows[0];
}

// Routes
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'password too short' });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'email already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    const token = signToken({ id: user.id, email: user.email });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Audit endpoint: push a task to Redis list
app.post('/api/audit', authenticateJWT, async (req, res) => {
  try {
    const task = {
      action: 'start_audit',
      user_id: req.user.id,
      requested_at: new Date().toISOString(),
      params: req.body.params || {}
    };
    await redisClient.lPush('audit_tasks', JSON.stringify(task));
    res.status(202).json({ status: 'queued' });
  } catch (err) {
    console.error('Failed to queue audit task', err);
    res.status(500).json({ error: 'failed to queue task' });
  }
});

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
