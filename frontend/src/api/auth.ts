import { request } from "./client";
import type { AuthUser } from "./types";

export function register(params: { username: string; phoneNumber: string; password: string }) {
  return request<AuthUser>("/api/auth/register", { method: "POST", body: params });
}

export function login(params: { username: string; password: string }) {
  return request<AuthUser>("/api/auth/login", { method: "POST", body: params });
}

export function logout() {
  return request<null>("/api/auth/logout", { method: "POST" });
}
