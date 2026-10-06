import { Bell, CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ToastInput = { kind: "success" | "error" | "info"; message: string };
type ToastItem = ToastInput & { id: number };

const MAX_TOASTS = 4;
const DURATION_MS: Record<ToastInput["kind"], number> = { success: 5000, error: 8000, info: 7000 };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = ++nextId.current;
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), DURATION_MS[toast.kind]),
      );
      setToasts((current) => {
        const next = [...current, { ...toast, id }];
        for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) {
          clearTimeout(timers.current.get(dropped.id));
          timers.current.delete(dropped.id);
        }
        return next.slice(-MAX_TOASTS);
      });
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) clearTimeout(timer);
      active.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Phones: a compact stack at the top, newest two only, so forms and the chat box near the bottom stay usable. */}
      <div className="pointer-events-none fixed inset-x-3 top-3 z-50 flex flex-col gap-2 max-sm:[&>*:nth-last-child(n+3)]:hidden sm:inset-x-auto sm:top-auto sm:bottom-4 sm:right-4 sm:w-[min(360px,calc(100vw-32px))]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-[13px] leading-snug shadow-xl sm:p-3 sm:text-sm"
          >
            {toast.kind === "error" ? (
              <WarningCircle aria-hidden="true" size={20} weight="fill" className="shrink-0 text-[var(--pink)]" />
            ) : toast.kind === "info" ? (
              <Bell aria-hidden="true" size={20} weight="fill" className="shrink-0 text-[var(--accent)]" />
            ) : (
              <CheckCircle aria-hidden="true" size={20} weight="fill" className="shrink-0 text-[var(--green)]" />
            )}
            <p className="min-w-0 flex-1 break-words">{toast.message}</p>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="shrink-0 text-[var(--muted,inherit)] hover:text-[var(--lavender)]"
              onClick={() => dismiss(toast.id)}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return show;
}
