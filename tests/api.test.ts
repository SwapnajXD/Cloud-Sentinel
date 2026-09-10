import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const mockQuery = jest.fn();
const mockConnectQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(() => Promise.resolve({ query: mockConnectQuery, release: mockRelease }));
const mockUser = { exists: true };
jest.mock('pg', () => ({ Pool: jest.fn(() => ({
  query: (sql: string, params: unknown[]) => sql.startsWith('SELECT id FROM users WHERE id =')
    ? Promise.resolve({ rows: mockUser.exists ? [{ id: 1 }] : [], rowCount: mockUser.exists ? 1 : 0 }) : mockQuery(sql, params),
  connect: mockConnect, end: jest.fn(),
})) }));
const mockLPush = jest.fn();
const mockPing = jest.fn();
jest.mock('redis', () => ({ createClient: jest.fn(() => ({ on: jest.fn(), isOpen: true, lPush: mockLPush, ping: mockPing })) }));
import { app } from '../gateway/src/app';
import { initDb } from '../gateway/src/lib/database';
const token = () => jwt.sign({ id: 1, email: 'owner@example.com' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
let ip = 1;
const auth = () => ({ Authorization: `Bearer ${token()}`, 'X-Forwarded-For': `10.0.0.${ip++}` });
beforeEach(() => {
  app.set('trust proxy', 1);
  mockUser.exists = true;
  mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  mockConnectQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  mockLPush.mockReset().mockResolvedValue(1);
  mockPing.mockReset().mockResolvedValue('PONG');
  mockRelease.mockClear();
});
describe('owner authentication', () => {
  test('first account is hashed and returns no password/token', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, email: 'owner@example.com' }], rowCount: 1 });
    const res = await request(app).post('/api/register').set(auth()).send({ email: 'OWNER@example.com', password: 'secure-password-123' });
    expect(res.status).toBe(201); expect(res.body.password).toBeUndefined();
    const params = mockQuery.mock.calls[0][1]; expect(params[0]).toBe('owner@example.com');
    expect(await bcrypt.compare('secure-password-123', params[1])).toBe(true);
  });
  test('database single-owner conflict closes registration, including concurrent requests', async () => {
    mockQuery.mockRejectedValue({ code: '23505' });
    const res = await request(app).post('/api/register').set(auth()).send({ email: 'other@example.com', password: 'secure-password-123' });
    expect(res.status).toBe(403);
  });
  test.each([{ email: {}, password: 'password123456' }, { email: 'bad', password: 'password123456' }, { email: 'a@b.com', password: 'short' }, { email: 'a@b.com', password: 'é'.repeat(40) }])('rejects malformed registration %j', async body => {
    const res = await request(app).post('/api/register').set(auth()).send(body); expect(res.status).toBe(400);
  });
  test('valid login signs a one-hour token', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, email: 'owner@example.com', password: await bcrypt.hash('secure-password-123', 12) }], rowCount: 1 });
    const res = await request(app).post('/api/login').set(auth()).send({ email: 'OWNER@example.com', password: 'secure-password-123' });
    expect(res.status).toBe(200); const claims = jwt.verify(res.body.token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(3600);
  });
  test('unknown owner and wrong password return 401', async () => {
    const unknown = await request(app).post('/api/login').set(auth()).send({ email: 'nobody@example.com', password: 'wrong' });
    expect(unknown.status).toBe(401);
    mockQuery.mockResolvedValue({ rows: [{ id: 1, password: await bcrypt.hash('correct', 12) }], rowCount: 1 });
    expect((await request(app).post('/api/login').set(auth()).send({ email: 'owner@example.com', password: 'wrong' })).status).toBe(401);
  });
  test('malformed login is a client error', async () => {
    expect((await request(app).post('/api/login').set(auth()).send({ email: 12, password: {} })).status).toBe(400);
  });
  test('rate limits repeated authentication attempts', async () => {
    const headers = auth(); let status = 0;
    for (let i = 0; i < 11; i++) status = (await request(app).post('/api/login').set(headers).send({})).status;
    expect(status).toBe(429);
  });
  test.each(['/api/reports', '/api/tasks', '/api/schedules', '/api/aws-connections', '/api/system', '/api/dead-letter'])('%s requires auth', async url => {
    expect((await request(app).get(url).set('X-Forwarded-For', `10.0.1.${ip++}`)).status).toBe(401);
  });
  test('deleted owner tokens are rejected', async () => {
    mockUser.exists = false; expect((await request(app).get('/api/reports').set(auth())).status).toBe(401);
  });
  test('deletion requires a valid password and uses owner ID', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ password: await bcrypt.hash('correct-password', 12) }] });
    expect((await request(app).delete('/api/account').set(auth()).send({ password: 'correct-password' })).status).toBe(200);
    expect(mockQuery).toHaveBeenLastCalledWith('DELETE FROM users WHERE id = $1', [1]);
  });
});
describe('durable scan API', () => {
  test('accepted task survives a Redis failure and preserves connection/scope', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockLPush.mockRejectedValue(new Error('offline'));
    const res = await request(app).post('/api/audit').set(auth()).send({ connection_id: 7, region: 'ap-south-1', services: ['ec2', 'iam'] });
    expect(res.status).toBe(202);
    const payload = JSON.parse(mockQuery.mock.calls[1][1][4]);
    expect(payload).toMatchObject({ connection_id: 7, region: 'ap-south-1', services: ['ec2', 'iam'], user_id: 1 });
    expect(payload.task_id).toBe(res.body.task_id);
  });
  test.each([{ connection_id: -1 }, { connection_id: '1 OR 1=1' }, { region: 'bad' }, { mode: 'bogus' }, { services: [] }, { services: ['secrets'] }])('rejects bad scope %j', async body => {
    expect((await request(app).post('/api/audit').set(auth()).send(body)).status).toBe(400);
  });
  test('foreign/disconnected connection is never accepted', async () => {
    expect((await request(app).post('/api/audit').set(auth()).send({ connection_id: 9 })).status).toBe(400);
    expect(mockLPush).not.toHaveBeenCalled();
  });
  test('task lookup is owner-scoped and missing tasks are 404', async () => {
    expect((await request(app).get('/api/audit/task-1').set(auth())).status).toBe(404);
    expect(mockQuery.mock.calls[0][1]).toEqual(['task-1', 1]);
  });
  test.each(['-1', 'NaN', '0', '1.2', '99999999999999999'])('rejects report limit %s', async limit => {
    expect((await request(app).get(`/api/reports?limit=${limit}`).set(auth())).status).toBe(400);
  });
  test('caps report limit and scopes query', async () => {
    await request(app).get('/api/reports?limit=9999').set(auth()); expect(mockQuery.mock.calls[0][1]).toEqual([1, 500]);
  });
  test('report detail is owner-scoped', async () => {
    expect((await request(app).get('/api/reports/9').set(auth())).status).toBe(404);
    expect(mockQuery.mock.calls[0][1]).toEqual([9, 1]);
  });
});
describe('connections, schedules, and failed task review', () => {
  test('schedule stores selected connection and scope', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 4 }], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ id: 8 }], rowCount: 1 });
    const res = await request(app).post('/api/schedules').set(auth()).send({ connection_id: 4, interval_hours: 6, region: 'eu-west-1', services: ['s3'] });
    expect(res.status).toBe(201); expect(mockQuery.mock.calls[1][1]).toEqual([1, 'aws', 6, 4, 'eu-west-1', '["s3"]']);
  });
  test.each([0, -1, 169, 1.2, 'bad'])('rejects interval %s', async interval_hours => {
    expect((await request(app).post('/api/schedules').set(auth()).send({ interval_hours })).status).toBe(400);
  });
  test('pause requires boolean and is owner-scoped', async () => {
    expect((await request(app).patch('/api/schedules/1').set(auth()).send({ enabled: 'false' })).status).toBe(400);
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: 1, enabled: false }] });
    expect((await request(app).patch('/api/schedules/1').set(auth()).send({ enabled: false })).status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([false, 1, 1]);
  });
  test('connection validation rejects non-string External ID', async () => {
    expect((await request(app).post('/api/aws-connections').set(auth()).send({ role_arn: 'arn:aws:iam::123456789012:role/CloudSentinelScanRole', external_id: {} })).status).toBe(400);
  });
  test('connection response selects no External ID', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: 1, label: 'Prod' }] });
    const result = await request(app).post('/api/aws-connections').set(auth()).send({ role_arn: 'arn:aws:iam::123456789012:role/CloudSentinelScanRole', external_id: 'unique-external-id-123', label: 'Prod' });
    expect(result.status).toBe(201); expect(result.body.external_id).toBeUndefined();
    expect(mockQuery.mock.calls[0][0].split('RETURNING')[1]).not.toContain('external_id');
  });
  test('disconnect pauses schedules transactionally', async () => {
    mockConnectQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: 1 }] });
    expect((await request(app).delete('/api/aws-connections/1').set(auth())).status).toBe(200);
    expect(mockConnectQuery.mock.calls.map(c => c[0]).join(' ')).toContain('enabled=false');
    expect(mockConnectQuery).toHaveBeenLastCalledWith('COMMIT'); expect(mockRelease).toHaveBeenCalled();
  });
  test('dead-letter dismissal updates one owned row without rebuilding Redis', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ task_id: 'task-1' }] });
    expect((await request(app).delete('/api/dead-letter/task-1').set(auth())).status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['task-1', 1]); expect(mockLPush).not.toHaveBeenCalled();
  });
});
describe('AI and readiness', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; delete process.env.GEMINI_API_KEY; });
  test('missing optional key is a clear unavailable response', async () => {
    delete process.env.GEMINI_API_KEY;
    expect((await request(app).post('/api/ai/summary').set(auth()).send({ report: { findings: [] } })).status).toBe(503);
  });
  test.each([false, true])('upstream failure/empty response never succeeds (%s)', async ok => {
    process.env.GEMINI_API_KEY = 'test-key'; global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => ({ candidates: [] }) });
    expect((await request(app).post('/api/ai/summary').set(auth()).send({ report: { findings: [] } })).status).toBe(502);
  });
  test('timeout is reported', async () => {
    process.env.GEMINI_API_KEY = 'test-key'; global.fetch = jest.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const res = await request(app).post('/api/ai/summary').set(auth()).send({ report: {} }); expect(res.status).toBe(502); expect(res.body.error).toMatch(/timed out/);
  });
  test('generated text succeeds and has a timeout signal', async () => {
    process.env.GEMINI_API_KEY = 'test-key'; global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Review the evidence.' }] } }] }) });
    expect((await request(app).post('/api/ai/summary').set(auth()).send({ report: {} })).body.summary).toBe('Review the evidence.');
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal).toBeDefined();
  });
  test('system exposes statuses, never secret values', async () => {
    process.env.GEMINI_API_KEY = 'secret-that-must-not-leak';
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ alive: true }] });
    const res = await request(app).get('/api/system').set(auth()); expect(res.status).toBe(200); expect(res.body.single_user).toBe(true); expect(JSON.stringify(res.body)).not.toContain('secret-that-must-not-leak');
  });
});
describe('schema migrations', () => {
  test('migration DDL and version ledger are inside a transaction lock', async () => {
    await initDb();
    const statements = mockConnectQuery.mock.calls.map(c => c[0]);
    expect(statements[0]).toBe('BEGIN'); expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(statements.some(s => s.includes('users_single_owner'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT'); expect(mockRelease).toHaveBeenCalled();
  });
  test('failed migration rolls back and releases the connection', async () => {
    mockConnectQuery.mockRejectedValueOnce(new Error('DDL failed'));
    await expect(initDb()).rejects.toThrow('DDL failed'); expect(mockConnectQuery).toHaveBeenLastCalledWith('ROLLBACK'); expect(mockRelease).toHaveBeenCalled();
  });
});
