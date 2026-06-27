// ==============================
// ✅ Base URL (IMPORTANT)
// ==============================

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL!;

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

  if (res.status === 401) {
    throw new Error("Session expired");
  }

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
// ✅ API Helpers
// ==============================

// 🔐 Login
export async function login(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Login failed");
  }

  return res.json();
}

// 🆕 Register
export async function register(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Registration failed");
  }

  return res.json();
}

// 📊 Fetch reports
export function getReports(token: string) {
  return apiRequest<ReportsResponse>(
    `${BASE_URL}/api/reports`,
    {},
    token
  );
}

// 🚀 Queue audit
export function queueAudit(token: string, scope: string) {
  return apiRequest<ActionResponse>(
    `${BASE_URL}/api/audit`,
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
    `${BASE_URL}/api/account`,
    {
      method: "DELETE",
      body: JSON.stringify({ password }),
    },
    token
  );
}