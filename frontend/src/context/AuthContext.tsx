import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import * as authApi from "../api/auth";
import { setAccessToken, tryRefresh } from "../api/client";
import type { AuthUser } from "../api/types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, phoneNumber: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On first load there's no access token in memory (page reloads clear
  // it by design), so we try the httpOnly refresh cookie once. A
  // successful refresh returns the user directly, which is what lets us
  // restore the session without a login-screen flash.
  useEffect(() => {
    (async () => {
      const restoredUser = await tryRefresh<AuthUser>();
      if (restoredUser) setUser(restoredUser);
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await authApi.login({ username, password });
    setUser(u);
  }, []);

  const register = useCallback(async (username: string, phoneNumber: string, password: string) => {
    const u = await authApi.register({ username, phoneNumber, password });
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
