// ==============================
// ✅ Base URL Config & Verification
// ==============================
const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "";

if (!BASE_URL && typeof window !== "undefined") {
  console.warn("⚠️ Warning: NEXT_PUBLIC_BACKEND_URL environment variable is missing.");
}

// ==============================
// ✅ Core API request helper
// ==============================
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  // ✅ Read text stream once to handle both error strings and valid data streams safely
  const text = await res.text();

  if (!res.ok) {
    console.error("API ERROR:", endpoint, text);

    if (res.status === 401 && typeof window !== "undefined") {
      // Token missing/expired/invalid - let AuthProvider know so it can
      // clear the stale session and send the user back to /login instead
      // of every subsequent request just silently failing with a 401.
      window.dispatchEvent(new Event("sentinel:session-expired"));
    }

    throw new Error(text || `Request failed: ${endpoint} (Status: ${res.status})`);
  }

  if (!text.trim()) {
    // If it's a 204 No Content or successful delete, don't crash on JSON parsing
    if (res.status === 204 || options.method === "DELETE") {
      return { status: "success" } as unknown as T;
    }
    throw new Error(`Empty response payload from ${endpoint}`);
  }

  return JSON.parse(text);
}

// ==============================
// ✅ Types
// ==============================
export type ReportsResponse = {
  reports: any[];
  count?: number;
};

export type AuthResponse = {
  token: string;
  message?: string;
};

export type ActionResponse = {
  status?: string;
  message?: string;
  error?: string;
  task_id?: string;
};

export type TaskStatusResponse = {
  task_id: string;
  status: "queued" | "running" | "done" | "error";
  mode: string;
  report_id: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

// ==============================
// ✅ API Helpers
// ==============================

// 🔐 Login (Refactored to safely use unified apiRequest)
export async function login(email: string, password: string) {
  return apiRequest<AuthResponse>("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// 🆕 Register (Refactored to safely use unified apiRequest)
export async function register(email: string, password: string) {
  return apiRequest<AuthResponse>("/api/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// 📊 Fetch reports
export function getReports(token: string) {
  return apiRequest<ReportsResponse>(
    "/api/reports",
    { method: "GET" },
    token
  );
}

// 🚀 Queue audit
export function queueAudit(
  token: string,
  scope: string,
  mode: "aws" | "floci" = "aws"
) {
  return apiRequest<ActionResponse>(
    "/api/audit",
    {
      method: "POST",
      body: JSON.stringify({
        mode,
        params: { scope },
      }),
    },
    token
  );
}

// 📡 Poll the status of a previously queued audit
export function getTaskStatus(token: string, taskId: string) {
  return apiRequest<TaskStatusResponse>(
    `/api/audit/${taskId}`,
    { method: "GET" },
    token
  );
}

// ❌ Delete account
export function deleteAccount(token: string, password: string) {
  return apiRequest<ActionResponse>(
    "/api/account",
    {
      method: "DELETE",
      body: JSON.stringify({ password }),
    },
    token
  );
}

// 🤖 AI summary for a given report (requires GEMINI_API_KEY on the gateway)
export function getAiSummary(token: string, report: any) {
  return apiRequest<{ summary?: string; error?: string }>(
    "/api/ai/summary",
    {
      method: "POST",
      body: JSON.stringify({ report }),
    },
    token
  );
}

export type DeadLetterTask = {
  task_id: string;
  user_id: number;
  action: string;
  mode: string;
  requested_at?: string;
  params?: any;
  final_error?: string;
  _retries?: number;
};

// ⚰️ Tasks that exhausted every retry
export function getDeadLetterTasks(token: string) {
  return apiRequest<{ tasks: DeadLetterTask[] }>(
    "/api/dead-letter",
    { method: "GET" },
    token
  );
}

export function dismissDeadLetterTask(token: string, taskId: string) {
  return apiRequest<ActionResponse>(
    `/api/dead-letter/${taskId}`,
    { method: "DELETE" },
    token
  );
}

export type Schedule = {
  id: number;
  mode: string;
  interval_hours: number;
  next_run_at: string;
  created_at: string;
};

// 🔁 Recurring scans
export function getSchedules(token: string) {
  return apiRequest<{ schedules: Schedule[] }>(
    "/api/schedules",
    { method: "GET" },
    token
  );
}

export function createSchedule(token: string, mode: "aws" | "floci", intervalHours: number) {
  return apiRequest<Schedule>(
    "/api/schedules",
    {
      method: "POST",
      body: JSON.stringify({ mode, interval_hours: intervalHours }),
    },
    token
  );
}

export function deleteSchedule(token: string, id: number) {
  return apiRequest<ActionResponse>(
    `/api/schedules/${id}`,
    { method: "DELETE" },
    token
  );
}