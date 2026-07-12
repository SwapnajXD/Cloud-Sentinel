"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { login as apiLogin, register as apiRegister } from "@/lib/api";

type AuthContextValue = {
  token: string | null;
  email: string | null;
  /** True while the very first localStorage read is in flight, so pages
   * can avoid a flash of "signed out" before we know the real state. */
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem("token"));
    setEmail(localStorage.getItem("email"));
    setReady(true);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    localStorage.setItem("token", res.token);
    localStorage.setItem("email", email);
    setToken(res.token);
    setEmail(email);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    // /api/register only creates the account and returns {id, email} - it
    // doesn't hand back a token, so sign in right after to get one and
    // land the user straight in the console instead of a second form.
    await apiRegister(email, password);
    await signIn(email, password);
  }, [signIn]);

  const signOut = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("email");
    setToken(null);
    setEmail(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, email, ready, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
