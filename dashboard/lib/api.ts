// ==============================
// ✅ Core API request helper
// ==============================

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const res = await fetch(endpoint, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  // ✅ Handle auth expiration
  if (res.status === 401) {
    throw new Error("Session expired");
  }

  // ✅ Read response safely
  const text = await res.text();

  if (!text.trim()) {
    throw new Error(`Empty response from ${endpoint}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response from ${endpoint}`);
  }
}

// ==============================
// ✅ Types
// ==============================

export type ReportsResponse = {
  reports: any[];
  count: number;
};

export type AuthResponse = {
  token: string;
};

export type ActionResponse = {
  status?: string;
  message?: string;
  error?: string;
};

// ==============================
// ✅ API Helpers (Readable)
// ==============================

// 🔐 Login
export function login(email: string, password: string) {
  return apiRequest<AuthResponse>("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// 🆕 Register
export function register(email: string, password: string) {
  return apiRequest("/api/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// 📊 Fetch reports
export function getReports(token: string) {
  return apiRequest<ReportsResponse>("/api/reports", {}, token);
}

// 🚀 Queue audit
export function queueAudit(token: string, scope: string) {
  return apiRequest<ActionResponse>(
    "/api/audit",
    {
      method: "POST",
      body: JSON.stringify({
        params: { scope },
      }),
    },
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