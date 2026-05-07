require('dotenv').config();
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import * as bcrypt from 'bcryptjs';
import { Pool, QueryResult } from 'pg';
import { createClient } from 'redis';
import cors from 'cors';
import AWS from 'aws-sdk';
import { spawn } from 'child_process';

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      report JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      command TEXT NOT NULL,
      output TEXT,
      exit_code INTEGER,
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

// Get reports: retrieve audit reports for authenticated user
app.get('/api/reports', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as TokenPayload;
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 500);
    const offset = parseInt((req.query.offset as string) || '0');

    const result = await pool.query(
      'SELECT id, report, created_at FROM audit_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [user.id, limit, offset]
    );
    res.json({ reports: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Failed to fetch reports', err);
    res.status(500).json({ error: 'failed to fetch reports' });
  }
});

// Delete account: remove user and all associated data
app.delete('/api/account', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as TokenPayload;
    const { password } = req.body;

    if (!password) {
      res.status(400).json({ error: 'password required for account deletion' });
      return;
    }

    // Verify password before deletion
    const userRow = (await pool.query('SELECT email FROM users WHERE id = $1', [user.id])).rows[0];
    const dbUser = await findUserByEmail(userRow.email);
    if (!dbUser || !(await bcrypt.compare(password, dbUser.password))) {
      res.status(401).json({ error: 'invalid password' });
      return;
    }

    // Delete user (cascade will delete reports)
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    res.json({ message: 'account deleted successfully' });
  } catch (err) {
    console.error('Failed to delete account', err);
    res.status(500).json({ error: 'failed to delete account' });
  }
});

// Terminal: List EC2 instances available for SSM session
app.get('/api/terminal/instances', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  try {
    const ec2 = new AWS.EC2({ region: process.env.AWS_REGION || 'ap-south-1' });
    const data = await ec2.describeInstances({
      Filters: [{ Name: 'instance-state-name', Values: ['running'] }]
    }).promise();

    const instances = data.Reservations?.flatMap(r => r.Instances?.map(i => ({
      id: i.InstanceId,
      name: i.Tags?.find(t => t.Key === 'Name')?.Value || i.InstanceId,
      state: i.State?.Name,
      type: i.InstanceType,
      publicIp: i.PublicIpAddress,
      launchTime: i.LaunchTime
    })) || []) || [];

    res.json({ instances });
  } catch (err: any) {
    console.error('Failed to list instances', err);
    if (err && (err.code === 'RequestExpired' || err.code === 'RequestTimeTooSkewed')) {
      res.status(440).json({ error: 'AWS request expired or system clock skew detected. Refresh AWS credentials and ensure container clock is correct.' });
      return;
    }
    if (err && (err.code === 'CredentialsError' || err.code === 'UnknownEndpoint')) {
      res.status(502).json({ error: 'AWS credentials missing or AWS unreachable from container.' });
      return;
    }
    res.status(500).json({ error: 'failed to list instances' });
  }
});

// Terminal: Start SSM session (will return session ID and WebSocket endpoint details)
app.post('/api/terminal/session', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  try {
    const { instanceId } = req.body;
    if (!instanceId) {
      res.status(400).json({ error: 'instanceId required' });
      return;
    }

    const ssm = new AWS.SSM({ region: process.env.AWS_REGION || 'ap-south-1' });
    const data = await ssm.startSession({
      Target: instanceId,
      DocumentName: 'AWS-StartInteractiveCommand',
      Parameters: { command: ['/bin/bash'] }
    }).promise();

    res.json({
      sessionId: data.SessionId,
      tokenValue: data.TokenValue,
      streamUrl: data.StreamUrl,
      instanceId
    });
  } catch (err) {
    console.error('Failed to start session', err);
    res.status(500).json({ error: 'failed to start session' });
  }
});

// Terminal: Execute AWS CLI command (alternative to direct session)
app.post('/api/terminal/exec', authenticateJWT, async (req: Request, res: Response): Promise<void> => {
  try {
    const { command } = req.body;
    if (!command) {
      res.status(400).json({ error: 'command required' });
      return;
    }

    // Whitelist safe commands
    const allowedPrefixes = ['aws ec2 describe', 'aws ec2 list', 'aws s3api list', 'aws s3api head', 'aws iam get'];
    const isAllowed = allowedPrefixes.some(prefix => command.toLowerCase().startsWith(prefix));
    
    if (!isAllowed) {
      res.status(403).json({ error: 'command not allowed - only read operations permitted' });
      return;
    }

    return new Promise<void>((resolve) => {
      let output = '';
      let errOutput = '';

      const proc = spawn('bash', ['-c', command], {
        env: {
          ...process.env,
          AWS_REGION: process.env.AWS_REGION || 'ap-south-1'
        }
      });

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        errOutput += data.toString();
      });

      proc.on('close', (code) => {
        // Log command execution
        pool.query(
          'INSERT INTO audit_logs (user_id, command, output, exit_code) VALUES ($1, $2, $3, $4)',
          [(req as any).user.id, command, output || errOutput, code]
        ).catch(e => console.error('Failed to log command', e));

        if (code === 0) {
          res.json({ output, exitCode: code });
        } else {
          res.status(500).json({ error: errOutput || output, exitCode: code });
        }
        resolve();
      });

      setTimeout(() => {
        proc.kill();
        res.status(408).json({ error: 'command timeout' });
        resolve();
      }, 30000); // 30 second timeout
    });
  } catch (err) {
    console.error('Failed to execute command', err);
    res.status(500).json({ error: 'failed to execute command' });
  }
});

// Health
app.get('/health', (req: Request, res: Response): void => {
  res.json({ status: 'ok' });
});

// Config UI
app.get('/config', (req: Request, res: Response): void => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Cloud-Sentinel Config</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 2rem auto; padding: 1rem; }
    .card { background: #f5f5f5; border-radius: 8px; padding: 2rem; margin-bottom: 1.5rem; }
    h1 { color: #333; }
    h2 { color: #666; margin-top: 0; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; font-weight: 500; margin-bottom: 0.5rem; color: #333; }
    input, textarea, select { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; }
    button { background: #007bff; color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #0056b3; }
    .button-group { display: flex; gap: 0.5rem; }
    .danger-btn { background: #dc3545; }
    .danger-btn:hover { background: #c82333; }
    .success-msg { color: #28a745; padding: 1rem; background: #d4edda; border-radius: 4px; margin-bottom: 1rem; }
    .error-msg { color: #dc3545; padding: 1rem; background: #f8d7da; border-radius: 4px; margin-bottom: 1rem; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>☁️ Cloud-Sentinel Config</h1>
  
  <div class="card" id="login">
    <h2>Login</h2>
    <div id="login-msg"></div>
    <div class="form-group">
      <label>Email</label>
      <input type="email" id="login-email" placeholder="user@example.com">
    </div>
    <div class="form-group">
      <label>Password</label>
      <input type="password" id="login-password" placeholder="Enter password">
    </div>
    <button onclick="login()">Login</button>
  </div>

  <div id="authenticated" class="hidden">
    <div class="card">
      <h2>Welcome, <span id="user-email"></span></h2>
    </div>

    <div class="card">
      <h2>Queue Audit</h2>
      <p>Trigger a new AWS infrastructure audit scan.</p>
      <button onclick="queueAudit()">Start Audit</button>
      <div id="audit-msg"></div>
    </div>

    <div class="card">
      <h2>View Reports</h2>
      <p>Retrieve your past audit reports.</p>
      <div id="reports-container"></div>
      <button onclick="fetchReports()">Refresh Reports</button>
    </div>

    <div class="card" style="background: #ffe6e6;">
      <h2>Danger Zone</h2>
      <p>Delete your account and all associated data. This action cannot be undone.</p>
      <div class="form-group">
        <label>Confirm Password</label>
        <input type="password" id="delete-password" placeholder="Enter your password">
      </div>
      <button class="danger-btn" onclick="deleteAccount()">Delete Account</button>
      <div id="delete-msg"></div>
    </div>

    <button onclick="logout()" style="width: 100%; margin-top: 1rem;">Logout</button>
  </div>

  <script>
    let token = localStorage.getItem('token');
    let userEmail = localStorage.getItem('email');

    function updateUI() {
      const authDiv = document.getElementById('authenticated');
      if (token) {
        document.getElementById('login').style.display = 'none';
        authDiv.classList.remove('hidden');
        document.getElementById('user-email').textContent = userEmail;
      } else {
        authDiv.classList.add('hidden');
        document.getElementById('login').style.display = 'block';
      }
    }

    async function login() {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const msgDiv = document.getElementById('login-msg');

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
          token = data.token;
          userEmail = email;
          localStorage.setItem('token', token);
          localStorage.setItem('email', email);
          msgDiv.innerHTML = '';
          updateUI();
          fetchReports();
        } else {
          msgDiv.innerHTML = '<div class="error-msg">' + (data.error || 'Login failed') + '</div>';
        }
      } catch (err) {
        msgDiv.innerHTML = '<div class="error-msg">Error: ' + err.message + '</div>';
      }
    }

    async function queueAudit() {
      const msgDiv = document.getElementById('audit-msg');
      try {
        const res = await fetch('/api/audit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ params: { scope: 'default' } })
        });
        const data = await res.json();
        if (res.ok) {
          msgDiv.innerHTML = '<div class="success-msg">✓ Audit queued successfully</div>';
        } else {
          msgDiv.innerHTML = '<div class="error-msg">' + (data.error || 'Failed to queue audit') + '</div>';
        }
      } catch (err) {
        msgDiv.innerHTML = '<div class="error-msg">Error: ' + err.message + '</div>';
      }
    }

    async function fetchReports() {
      const container = document.getElementById('reports-container');
      try {
        const res = await fetch('/api/reports', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (res.ok && data.reports.length > 0) {
          container.innerHTML = '<ul>' + data.reports.map(r => 
            '<li><strong>' + new Date(r.created_at).toLocaleString() + '</strong><br>' + 
            '<pre>' + JSON.stringify(r.report, null, 2).substring(0, 200) + '...</pre></li>'
          ).join('') + '</ul>';
        } else {
          container.innerHTML = '<p>No reports yet.</p>';
        }
      } catch (err) {
        container.innerHTML = '<div class="error-msg">Error: ' + err.message + '</div>';
      }
    }

    async function deleteAccount() {
      const password = document.getElementById('delete-password').value;
      const msgDiv = document.getElementById('delete-msg');

      if (!confirm('Are you sure? This cannot be undone.')) return;

      try {
        const res = await fetch('/api/account', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (res.ok) {
          msgDiv.innerHTML = '<div class="success-msg">✓ Account deleted</div>';
          setTimeout(() => logout(), 2000);
        } else {
          msgDiv.innerHTML = '<div class="error-msg">' + (data.error || 'Failed to delete') + '</div>';
        }
      } catch (err) {
        msgDiv.innerHTML = '<div class="error-msg">Error: ' + err.message + '</div>';
      }
    }

    function logout() {
      localStorage.removeItem('token');
      localStorage.removeItem('email');
      token = null;
      userEmail = null;
      document.getElementById('login-email').value = '';
      document.getElementById('login-password').value = '';
      updateUI();
    }

    updateUI();
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
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
