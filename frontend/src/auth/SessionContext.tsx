import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, apiFetch, keepSessionFresh, onSessionExpired } from "../api/client";
import type { User } from "../api/types";

type Session =
  | { status: "checking" }
  | { status: "authenticated"; user: User }
  | { status: "anonymous"; reason: "unauthorized" | "signed-out" }
  | { status: "error" };

type SessionContextValue = {
  session: Session;
  retry: () => void;
  signIn: (user: User) => void;
  updateUser: (user: User) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const destinationKey = "rollandplay:login-destination";

export function localDestination(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return null;
  const url = new URL(value, window.location.origin);
  if (url.origin !== window.location.origin) return null;
  if (!/^\/(rooms|friends|rule-books|sheets|maps)(\/|$)/.test(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function rememberDestination(value: string): void {
  const destination = localDestination(value);
  if (destination) sessionStorage.setItem(destinationKey, destination);
}

export function loginDestination(): string {
  return localDestination(sessionStorage.getItem(destinationKey)) ?? "/rooms";
}

export function clearDestination(): void {
  sessionStorage.removeItem(destinationKey);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const signIn = useCallback((user: User) => {
    revision.current += 1;
    setSession({ status: "authenticated", user });
  }, []);
  const updateUser = useCallback((user: User) => {
    setSession((current) => current.status === "authenticated" ? { status: "authenticated", user } : current);
  }, []);
  const retry = useCallback(() => {
    setSession({ status: "checking" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => onSessionExpired(() => {
    revision.current += 1;
    setSession({ status: "anonymous", reason: "unauthorized" });
  }), []);

  const signedIn = session.status === "authenticated";
  useEffect(() => signedIn ? keepSessionFresh() : undefined, [signedIn]);

  useEffect(() => {
    let active = true;
    const current = revision.current;
    apiFetch<User>("/api/me").then((user) => {
      if (active && current === revision.current) setSession({ status: "authenticated", user });
    }).catch((error: unknown) => {
      if (active && current === revision.current) {
        setSession(error instanceof ApiError && error.status === 401
          ? { status: "anonymous", reason: "unauthorized" }
          : { status: "error" });
      }
    });
    return () => { active = false; };
  }, [attempt]);

  const signOut = useCallback(async () => {
    await apiFetch<void>("/api/auth/logout", { method: "POST" });
    revision.current += 1;
    clearDestination();
    setSession({ status: "anonymous", reason: "signed-out" });
  }, []);

  return <SessionContext.Provider value={{ session, retry, signIn, updateUser, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("SessionProvider is required");
  return context;
}
