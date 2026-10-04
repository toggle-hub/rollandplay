import { restoreKeyOrder } from "./keyOrder";
import type { ServerEnvelope } from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
const WS_BASE_URL = (import.meta.env.VITE_WS_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const sessionExpiredListeners = new Set<() => void>();

export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function apiURL(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE_URL}${path}`;
}

function wsURL(path: string): string {
  if (WS_BASE_URL) return `${WS_BASE_URL}${path}`;
  if (API_BASE_URL.startsWith("https://"))
    return `wss://${API_BASE_URL.slice("https://".length)}${path}`;
  if (API_BASE_URL.startsWith("http://"))
    return `ws://${API_BASE_URL.slice("http://".length)}${path}`;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}

type RefreshResult = "ok" | "unauthorized" | "failed";

let refreshing: Promise<RefreshResult> | null = null;
// When the access cookie was last renewed and how many seconds it lasts.
let lastRefresh: { at: number; lifetime: number | null } | null = null;

async function requestRefresh(): Promise<RefreshResult> {
  try {
    const res = await fetch(apiURL("/api/auth/refresh"), { method: "POST", credentials: "include" });
    if (res.status === 401) return "unauthorized";
    if (!res.ok) return "failed";
    const body: unknown = await res.json().catch(() => null);
    const lifetime = body && typeof body === "object" && "access_expires_in" in body && typeof body.access_expires_in === "number" ? body.access_expires_in : null;
    lastRefresh = { at: Date.now(), lifetime };
    return "ok";
  } catch {
    return "failed";
  }
}

/** Renews the short-lived access cookie with the refresh cookie; concurrent callers share one request. */
export function refreshSession(): Promise<RefreshResult> {
  refreshing ??= requestRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Renew this many seconds before the access cookie runs out; retry this often when renewal fails.
const refreshMarginSeconds = 60;
const refreshRetrySeconds = 30;

/**
 * Renews the access cookie shortly before it expires for as long as the caller stays signed in, so
 * images and new websocket connections, which can't refresh on a 401 themselves, keep working.
 * Reports an expired session to `onSessionExpired` listeners. Returns a function that stops it.
 */
export function keepSessionFresh(): () => void {
  let stopped = false;
  let timer: number | undefined;
  const run = async () => {
    const result = await refreshSession();
    if (stopped) return;
    if (result === "unauthorized") {
      sessionExpiredListeners.forEach((listener) => listener());
      return;
    }
    const delay = result === "ok" ? dueInSeconds() ?? refreshRetrySeconds : refreshRetrySeconds;
    timer = window.setTimeout(run, Math.max(delay, 0) * 1000);
  };
  // Nothing is known about the access cookie after a page load, so that renews it at once.
  timer = window.setTimeout(run, Math.max(dueInSeconds() ?? 0, 0) * 1000);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

// Seconds until the access cookie should be renewed: `refreshMarginSeconds` before it expires,
// or halfway through its lifetime when that is shorter. Null when its lifetime is unknown.
function dueInSeconds(): number | null {
  if (!lastRefresh?.lifetime) return null;
  const renewAfter = Math.max(lastRefresh.lifetime - refreshMarginSeconds, lastRefresh.lifetime / 2);
  return (lastRefresh.at - Date.now()) / 1000 + renewAfter;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const options: RequestInit = {
    ...init,
    credentials: "include",
    headers: { ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) },
  };
  let res = await fetch(apiURL(path), options);
  // An expired access cookie is renewed once and the request repeated.
  if (res.status === 401 && !path.startsWith("/api/auth/") && (await refreshSession()) === "ok") res = await fetch(apiURL(path), options);
  if (!res.ok) {
    if (res.status === 401 && path !== "/api/me" && !path.startsWith("/api/auth/")) {
      sessionExpiredListeners.forEach((listener) => listener());
    }
    let message = `${res.status}`;
    try {
      const data = await res.json();
      message = data.error?.message ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return restoreKeyOrder(await res.json()) as T;
}
export const postJSON = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patchJSON = <T>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const deleteJSON = <T>(path: string) =>
  apiFetch<T>(path, { method: "DELETE" });
export const assetURL = (id: string) =>
  apiURL(`/api/assets/${encodeURIComponent(id)}`);
export function connectRoomSocket(
  roomId: string,
  onMessage: (event: ServerEnvelope) => void,
): WebSocket {
  const ws = new WebSocket(wsURL(`/api/rooms/${roomId}/ws`));
  ws.onmessage = (event) => onMessage(JSON.parse(event.data));
  return ws;
}
export const requestId = () => crypto.randomUUID();
