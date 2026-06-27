// ==============================
// ✅ Base URL
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
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  // ✅ FIXED: Proper error handling
  if (!res.ok) {
    const text = await res.text();
    console.error("API ERROR:", endpoint, text);
    throw new Error(text || `Request failed: ${endpoint}`);
  }

  // ✅ Parse response safely
  const text = await res.text();

  if (!text.trim()) {
    throw new Error(`Empty response from ${endpoint}`);
  }

  return JSON.parse(text);
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
    "/api/reports",
    {},
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