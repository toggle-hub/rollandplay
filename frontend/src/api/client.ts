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

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(apiURL(path), {
    ...init,
    credentials: "include",
    headers: { ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) },
  });
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
  return res.json() as Promise<T>;
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
