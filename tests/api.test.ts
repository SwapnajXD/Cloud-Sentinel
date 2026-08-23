/**
 * Integration-style tests against the actual exposed HTTP API, via
 * supertest, with Postgres (`pg`) and Redis mocked out - no live DB/Redis
 * needed to run these. Each mock function is reset between tests so call
 * queues (mockResolvedValueOnce etc.) never leak across test cases.
 *
 * Auth-limited routes (/api/register, /api/login) share a 10-req/15-min
 * rate limiter keyed by IP. To keep tests independent of each other and of
 * run order, each test group uses its own X-Forwarded-For value (trust
 * proxy is enabled) rather than sharing the loopback IP supertest uses by
 * default - the one exception is the dedicated rate-limit test, which
 * deliberately reuses a single IP to trigger the limit.
 */
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const mockQuery = jest.fn();
const mockPoolEnd = jest.fn().mockResolvedValue(undefined);

jest.mock("pg", () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    end: mockPoolEnd,
  })),
}));

const mockLPush = jest.fn();
const mockPing = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockLRange = jest.fn();
const mockMultiDel = jest.fn();
const mockMultiRPush = jest.fn();
const mockMultiExec = jest.fn().mockResolvedValue([]);

jest.mock("redis", () => ({
  createClient: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: mockConnect,
    disconnect: mockDisconnect,
    isOpen: true,
    lPush: mockLPush,
    ping: mockPing,
    lRange: mockLRange,
    multi: jest.fn().mockImplementation(() => ({
      del: mockMultiDel,
      rPush: mockMultiRPush,
      exec: mockMultiExec,
    })),
  })),
}));

// Imported after the mocks above so app.ts picks up the mocked pg/redis.
import { app } from "../gateway/src/app";

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

function tokenFor(id: number, email: string): string {
  return jwt.sign({ id, email }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockLPush.mockReset();
  mockPing.mockReset().mockResolvedValue("PONG");
  mockLRange.mockReset();
  mockMultiDel.mockReset();
  mockMultiRPush.mockReset();
  mockMultiExec.mockReset().mockResolvedValue([]);
});

describe("GET /health", () => {
  it("reports ok when postgres and redis both respond", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", checks: { postgres: "ok", redis: "ok" } });
    expect(typeof res.body.uptime).toBe("number");
  });

  it("reports degraded with a 503 when postgres is unreachable", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.postgres).toBe("error");
  });

  it("reports degraded with a 503 when redis is unreachable", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockPing.mockReset().mockRejectedValueOnce(new Error("redis down"));

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body.checks.redis).toBe("error");
  });
});

describe("POST /api/register", () => {
  const ip = freshIp();

  it("allows registration when no users exist yet (single-user mode, first account)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT ... LIMIT 1 -> no existing users
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "first@b.com" }] }); // INSERT

    const res = await request(app)
      .post("/api/register")
      .set("X-Forwarded-For", ip)
      .send({ email: "first@b.com", password: "supersecret" });

    expect(res.status).toBe(201);
  });

  it("rejects a second registration once a user already exists (single-user mode is the default)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // SELECT ... LIMIT 1 -> a user already exists

    const res = await request(app)
      .post("/api/register")
      .set("X-Forwarded-For", ip)
      .send({ email: "second@b.com", password: "supersecret" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/single-user mode/);
  });

  it("rejects a missing email/password", async () => {
    const res = await request(app).post("/api/register").set("X-Forwarded-For", ip).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  it("rejects an invalid email format", async () => {
    const res = await request(app)
      .post("/api/register")
      .set("X-Forwarded-For", ip)
      .send({ email: "not-an-email", password: "supersecret" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid email/);
  });

  it("rejects a password under 8 characters", async () => {
    const res = await request(app)
      .post("/api/register")
      .set("X-Forwarded-For", ip)
      .send({ email: "a@b.com", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weak password/);
  });

  it("creates a user and returns id + email (no password, no token)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SINGLE_USER_MODE check -> no existing users
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "a@b.com" }] });

    const res = await request(app)
      .post("/api/register")
      .set("X-Forwarded-For", ip)
      .send({ email: "a@b.com", password: "supersecret" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1, email: "a@b.com" });
    expect(res.body.password).toBeUndefined();
    expect(res.body.token).toBeUndefined();
  });

  it("returns 409 when the email is already registered", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SINGLE_USER_MODE check -> no existing users
    mockQuery.mockRejectedValueOnce({ code: "23505" });

    const res = await request(app)
      .post("/api/register")
      .set("X-Forwarded-For", ip)
      .send({ email: "dupe@b.com", password: "supersecret" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email exists");
  });
});

describe("POST /api/login", () => {
  const ip = freshIp();

  it("returns 401 for an unknown email", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post("/api/login")
      .set("X-Forwarded-For", ip)
      .send({ email: "ghost@b.com", password: "whatever1" });

    expect(res.status).toBe(401);
  });

  it("returns 401 for the wrong password", async () => {
    const hash = await bcrypt.hash("correct-password", 12);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "a@b.com", password: hash }] });

    const res = await request(app)
      .post("/api/login")
      .set("X-Forwarded-For", ip)
      .send({ email: "a@b.com", password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  it("returns a valid JWT for correct credentials", async () => {
    const hash = await bcrypt.hash("correct-password", 12);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "a@b.com", password: hash }] });

    const res = await request(app)
      .post("/api/login")
      .set("X-Forwarded-For", ip)
      .send({ email: "a@b.com", password: "correct-password" });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");

    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET as string) as any;
    expect(decoded.email).toBe("a@b.com");
    expect(decoded.id).toBe(1);
  });
});

describe("auth rate limiting", () => {
  it("returns 429 after exceeding 10 requests in the window from one IP", async () => {
    const ip = freshIp();
    mockQuery.mockResolvedValue({ rows: [] }); // every attempt: "unknown user" -> 401

    let last;
    for (let i = 0; i < 11; i++) {
      last = await request(app)
        .post("/api/login")
        .set("X-Forwarded-For", ip)
        .send({ email: "x@y.com", password: "whatever1" });
    }

    expect(last!.status).toBe(429);
    expect(last!.body.error).toMatch(/too many attempts/);
  });
});

describe("protected routes require a valid token", () => {
  it.each([
    ["post", "/api/audit"],
    ["get", "/api/audit/some-task-id"],
    ["get", "/api/reports"],
    ["delete", "/api/account"],
    ["post", "/api/ai/summary"],
    ["post", "/api/schedules"],
    ["get", "/api/schedules"],
    ["delete", "/api/schedules/1"],
    ["get", "/api/dead-letter"],
    ["delete", "/api/dead-letter/some-id"],
    ["get", "/api/aws-connections"],
    ["delete", "/api/aws-connections/1"],
  ])("%s %s returns 401 with no Authorization header", async (method, url) => {
    const res = await (request(app) as any)[method](url);
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed/invalid token", async () => {
    const res = await request(app)
      .get("/api/reports")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/audit", () => {
  it("queues a task and returns a task_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT INTO audit_tasks
    mockLPush.mockResolvedValueOnce(1);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/audit")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "aws" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("queued");
    expect(res.body.mode).toBe("aws");
    expect(typeof res.body.task_id).toBe("string");
    expect(mockLPush).toHaveBeenCalledWith("audit_tasks", expect.any(String));
  });

  it("treats any mode other than 'floci' as 'aws'", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockLPush.mockResolvedValueOnce(1);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/audit")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "not-a-real-mode" });

    expect(res.body.mode).toBe("aws");
  });

  it("accepts mode: floci", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockLPush.mockResolvedValueOnce(1);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/audit")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "floci" });

    expect(res.body.mode).toBe("floci");
  });

  it("rejects a connection_id that doesn't belong to the caller", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT ... aws_connections -> not found

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/audit")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "aws", connection_id: 999 });

    expect(res.status).toBe(400);
    expect(mockLPush).not.toHaveBeenCalled();
  });

  it("queues a task against a valid connection_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // SELECT ... aws_connections -> found
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT INTO audit_tasks
    mockLPush.mockResolvedValueOnce(1);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/audit")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "aws", connection_id: 7 });

    expect(res.status).toBe(202);
    const [, payload] = mockLPush.mock.calls[0];
    const task = JSON.parse(payload);
    expect(task.connection_id).toBe(7);
  });

  it("omitting connection_id still queues normally (legacy static-credential path)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT INTO audit_tasks (no connection lookup at all)
    mockLPush.mockResolvedValueOnce(1);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/audit")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "aws" });

    expect(res.status).toBe(202);
    const [, payload] = mockLPush.mock.calls[0];
    const task = JSON.parse(payload);
    expect(task.connection_id).toBeNull();
  });
});

describe("GET /api/audit/:task_id", () => {
  it("returns 404 when the task doesn't exist (or isn't this user's)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .get("/api/audit/does-not-exist")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("returns the task status row when found", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ task_id: "abc", status: "done", mode: "aws", report_id: 7, error: null }],
    });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .get("/api/audit/abc")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ task_id: "abc", status: "done", report_id: 7 });
  });
});

describe("GET /api/reports", () => {
  it("returns the caller's reports", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, report: { findings: [] }, created_at: "2026-01-01T00:00:00Z" }],
    });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .get("/api/reports")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
    expect(res.body.reports[0].id).toBe(1);
  });

  it("caps an oversized limit query param at 500", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const token = tokenFor(1, "a@b.com");
    await request(app)
      .get("/api/reports?limit=999999")
      .set("Authorization", `Bearer ${token}`);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe(500);
  });
});

describe("DELETE /api/account", () => {
  it("requires a password in the body", async () => {
    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/account")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 401 when the confirmation password is wrong", async () => {
    const hash = await bcrypt.hash("correct-password", 12);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "a@b.com", password: hash }] });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/account")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  it("deletes the account when the password is correct", async () => {
    const hash = await bcrypt.hash("correct-password", 12);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "a@b.com", password: hash }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE FROM users

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/account")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "correct-password" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
  });
});

describe("POST /api/ai/summary", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("requires a report in the body", async () => {
    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/ai/summary")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 500 with a clear error when GEMINI_API_KEY isn't configured", async () => {
    delete process.env.GEMINI_API_KEY;

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/ai/summary")
      .set("Authorization", `Bearer ${token}`)
      .send({ report: { findings: [] } });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("no api key");
  });
});

describe("POST /api/schedules", () => {
  it("rejects a non-integer interval_hours", async () => {
    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/schedules")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "aws", interval_hours: "not-a-number" });

    expect(res.status).toBe(400);
  });

  it("rejects an interval outside 1-168 hours", async () => {
    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/schedules")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "aws", interval_hours: 500 });

    expect(res.status).toBe(400);
  });

  it("creates a schedule with a valid interval", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, mode: "aws", interval_hours: 24, next_run_at: "2026-01-02T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }],
    });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/schedules")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "aws", interval_hours: 24 });

    expect(res.status).toBe(201);
    expect(res.body.interval_hours).toBe(24);
  });

  it("rejects a connection_id that doesn't belong to the caller", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT ... aws_connections -> not found

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/schedules")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "aws", interval_hours: 24, connection_id: 999 });

    expect(res.status).toBe(400);
  });

  it("requires a token", async () => {
    const res = await request(app).post("/api/schedules").send({ interval_hours: 24 });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/schedules", () => {
  it("returns the caller's schedules", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, mode: "aws", interval_hours: 24, next_run_at: "2026-01-02T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }],
    });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .get("/api/schedules")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.schedules).toHaveLength(1);
  });
});

describe("DELETE /api/schedules/:id", () => {
  it("returns 404 when the schedule doesn't exist or belongs to someone else", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/schedules/999")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("deletes the schedule when it belongs to the caller", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/schedules/1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe("POST /api/aws-connections", () => {
  it("rejects missing fields", async () => {
    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/aws-connections")
      .set("Authorization", `Bearer ${token}`)
      .send({ role_arn: "arn:aws:iam::123456789012:role/CloudSentinelScanRole" });

    expect(res.status).toBe(400);
  });

  it("rejects a role_arn that isn't a valid IAM role ARN", async () => {
    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/aws-connections")
      .set("Authorization", `Bearer ${token}`)
      .send({ role_arn: "not-an-arn", external_id: "abc123" });

    expect(res.status).toBe(400);
  });

  it("saves a valid connection and never echoes the external_id back", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1,
        role_arn: "arn:aws:iam::123456789012:role/CloudSentinelScanRole",
        label: "prod account",
        created_at: "2026-01-01T00:00:00Z",
      }],
    });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .post("/api/aws-connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        role_arn: "arn:aws:iam::123456789012:role/CloudSentinelScanRole",
        external_id: "super-secret-external-id",
        label: "prod account",
      });

    expect(res.status).toBe(201);
    expect(res.body.role_arn).toContain("CloudSentinelScanRole");
    expect(res.body.external_id).toBeUndefined();
  });

  it("requires a token", async () => {
    const res = await request(app).post("/api/aws-connections").send({});
    expect(res.status).toBe(401);
  });
});

describe("GET /api/aws-connections", () => {
  it("returns the caller's connections", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, role_arn: "arn:aws:iam::123456789012:role/X", label: null, created_at: "2026-01-01T00:00:00Z" }],
    });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .get("/api/aws-connections")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.connections).toHaveLength(1);
  });
});

describe("DELETE /api/aws-connections/:id", () => {
  it("returns 404 when the connection doesn't exist or belongs to someone else", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/aws-connections/999")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("deletes the connection when it belongs to the caller", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/aws-connections/1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe("GET /api/dead-letter", () => {
  it("returns only the caller's dead-lettered tasks", async () => {
    mockLRange.mockResolvedValueOnce([
      JSON.stringify({ task_id: "mine", user_id: 1, mode: "aws", final_error: "boom" }),
      JSON.stringify({ task_id: "not-mine", user_id: 2, mode: "aws", final_error: "boom" }),
    ]);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .get("/api/dead-letter")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].task_id).toBe("mine");
  });

  it("skips unparseable entries instead of crashing", async () => {
    mockLRange.mockResolvedValueOnce(["not json at all"]);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .get("/api/dead-letter")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toEqual([]);
  });

  it("requires a token", async () => {
    const res = await request(app).get("/api/dead-letter");
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/dead-letter/:task_id", () => {
  it("returns 404 when the task isn't found or belongs to someone else", async () => {
    mockLRange.mockResolvedValueOnce([
      JSON.stringify({ task_id: "not-mine", user_id: 2, mode: "aws" }),
    ]);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/dead-letter/mine")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(mockMultiDel).not.toHaveBeenCalled();
  });

  it("removes the matching task and rebuilds the list without it", async () => {
    mockLRange.mockResolvedValueOnce([
      JSON.stringify({ task_id: "keep-me", user_id: 1, mode: "aws" }),
      JSON.stringify({ task_id: "remove-me", user_id: 1, mode: "floci" }),
    ]);

    const token = tokenFor(1, "a@b.com");
    const res = await request(app)
      .delete("/api/dead-letter/remove-me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockMultiDel).toHaveBeenCalledWith("audit_tasks_dead");
    expect(mockMultiRPush).toHaveBeenCalledWith(
      "audit_tasks_dead",
      [JSON.stringify({ task_id: "keep-me", user_id: 1, mode: "aws" })]
    );
  });

  it("requires a token", async () => {
    const res = await request(app).delete("/api/dead-letter/some-id");
    expect(res.status).toBe(401);
  });
});
