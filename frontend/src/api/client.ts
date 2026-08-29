const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Access token lives in memory only — never localStorage/sessionStorage,
// so an XSS bug can't walk off with a long-lived credential. It's lost on
// full page reload by design; AuthProvider calls /api/auth/refresh on
// mount (using the httpOnly refresh cookie) to silently restore it.
let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    credentials: "include", // send the httpOnly refresh cookie
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const newToken = res.headers.get("X-Access-Token");
  if (newToken) accessToken = newToken;

  return res;
}

async function parseOrThrow(res: Response) {
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.details);
  }
  return data;
}

/**
 * Attempts to silently restore a session using the refresh cookie.
 * Returns the user if successful, or null if there's no valid session
 * (e.g. first visit, or the refresh token expired/was revoked).
 *
 * Deduplicated: refresh tokens are single-use and rotate on every call,
 * so if several requests 401 at the same moment (e.g. a page firing a
 * Promise.all of authenticated calls), only the *first* refresh attempt
 * can ever succeed — any concurrent one races against an already-rotated
 * token and fails. Sharing one in-flight promise means every caller
 * waits on the same attempt instead of each trying (and losing) their
 * own race.
 */
let inFlightRefresh: Promise<unknown> | null = null;

export async function tryRefresh<T = unknown>(): Promise<T | null> {
  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const res = await rawRequest("/api/auth/refresh", { method: "POST" });
        if (!res.ok) return null;
        return await parseOrThrow(res);
      } catch {
        return null;
      } finally {
        inFlightRefresh = null;
      }
    })();
  }
  return inFlightRefresh as Promise<T | null>;
}

/**
 * Main request helper. On a 401 (expired access token) it makes one
 * attempt to refresh and replay the original request before giving up —
 * this is what lets a user stay logged in across the 15-minute access
 * token lifetime without re-entering their password.
 */
export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await rawRequest(path, options);
  if (res.status === 401 && path !== "/api/auth/refresh") {
    const refreshed = await tryRefresh();
    if (refreshed) res = await rawRequest(path, options);
  }
  return parseOrThrow(res) as Promise<T>;
}
