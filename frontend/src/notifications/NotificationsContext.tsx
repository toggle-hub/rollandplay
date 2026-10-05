import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch, connectNotificationSocket } from "../api/client";
import type { AppNotification, NotificationsState } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { playerLabel } from "../components/PlayerName";
import { useToast } from "../components/Toast";

type Listener = (note: AppNotification) => void;

type NotificationsValue = NotificationsState & {
  /** Reloads what waits for the user. */
  refresh: () => Promise<void>;
  /** Calls `listener` for every notification, pushed or announced; returns an unsubscribe function. */
  subscribe: (listener: Listener) => () => void;
  /** Tells listeners about a change this tab made, e.g. a friend request accepted from the menu. */
  announce: (note: AppNotification) => void;
};

const empty: NotificationsState = { friend_requests: [], room_invitations: [] };
// Outside a provider (isolated component tests) notifications are simply empty and silent.
const inert: NotificationsValue = { ...empty, refresh: async () => {}, subscribe: () => () => {}, announce: () => {} };
const NotificationsContext = createContext<NotificationsValue>(inert);

// Reconnect delays grow from 1 s to 30 s while the notification socket keeps failing.
const reconnectBaseMs = 1000;
const reconnectMaxMs = 30_000;

/** The alert shown when a notification arrives; null for changes that only refresh lists. */
export function notificationMessage(note: AppNotification): string | null {
  const actor = note.actor ? playerLabel(note.actor) : "Someone";
  const room = note.room?.name ?? "a room";
  switch (note.kind) {
    case "friend.requested": return `${actor} sent you a friend request.`;
    case "friend.accepted": return `${actor} accepted your friend request.`;
    case "room_invitation.created": return `${actor} invited you to ${room}.`;
    case "room_invitation.accepted": return `${actor} joined ${room}.`;
    case "room_invitation.removed": return note.actor ? `${actor} declined your invitation to ${room}.` : null;
    default: return null;
  }
}

function isNotification(value: unknown): value is AppNotification {
  return !!value && typeof value === "object" && "kind" in value && typeof value.kind === "string";
}

/**
 * Keeps incoming friend requests and room invitations current for a signed-in user with a finished
 * profile. A websocket pushes each change; lists are reloaded when it (re)connects and when the
 * tab becomes visible again, so nothing missed while disconnected stays stale.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session.status === "authenticated" && session.user.profile_complete ? session.user.id : null;
  const toast = useToast();
  const [state, setState] = useState<NotificationsState>(empty);
  const listeners = useRef(new Set<Listener>());
  // Only the newest reload may set the state, so a slow older response can't win.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    const next = await apiFetch<NotificationsState>("/api/notifications");
    if (request === latest.current) setState({ friend_requests: next.friend_requests ?? [], room_invitations: next.room_invitations ?? [] });
  }, []);
  const announce = useCallback((note: AppNotification) => listeners.current.forEach((listener) => listener(note)), []);
  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  useEffect(() => {
    latest.current++;
    setState(empty);
    if (!userId) return;
    // Background reloads stay quiet; an expired session is reported by apiFetch itself.
    const reload = () => { refresh().catch(() => {}); };
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let failures = 0;
    const connect = () => {
      socket = connectNotificationSocket((event) => {
        if (event.type !== "notification" || !isNotification(event.body)) return;
        const note = event.body;
        const message = notificationMessage(note);
        if (message) toast({ kind: "info", message });
        announce(note);
        reload();
      });
      socket.onopen = () => {
        failures = 0;
        reload();
      };
      socket.onclose = () => {
        if (stopped) return;
        retry = window.setTimeout(connect, Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** failures++));
      };
    };
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    reload();
    connect();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onmessage = null;
        socket.close();
      }
    };
  }, [userId, refresh, announce, toast]);

  const value = useMemo(() => ({ ...state, refresh, subscribe, announce }), [state, refresh, subscribe, announce]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsValue {
  return useContext(NotificationsContext);
}

/** Calls the newest `listener` for every notification while the component is mounted. */
export function useNotificationEvents(listener: Listener): void {
  const { subscribe } = useNotifications();
  const current = useRef(listener);
  current.current = listener;
  useEffect(() => subscribe((note) => current.current(note)), [subscribe]);
}
