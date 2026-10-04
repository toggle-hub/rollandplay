import { useEffect, useRef, type KeyboardEvent } from "react";

export type EditorAction = { id: string; label: string; shortcut?: string; disabled?: boolean; danger?: boolean };

/** Right-click menu for the map editor selection, positioned in shell pixels and kept inside the shell. */
export function EditorContextMenu({ x, y, actions, onAction, onClose }: {
  x: number;
  y: number;
  actions: EditorAction[];
  onAction: (id: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button[role=menuitem]:not(:disabled)") ?? [])];

  useEffect(() => {
    items()[0]?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const enabled = items();
    if (enabled.length === 0) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    enabled[(index + step + enabled.length) % enabled.length].focus();
  };

  return <div
    ref={menuRef}
    role="menu"
    aria-label="Structure actions"
    className="absolute z-50 grid w-[200px] gap-0.5 rounded-xl border border-[var(--accent)]/25 bg-[var(--input)] p-1 shadow-2xl"
    style={{ left: `clamp(8px, ${x}px, calc(100% - 208px))`, top: `clamp(8px, ${y}px, calc(100% - 280px))` }}
    onPointerDown={(event) => event.stopPropagation()}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={onKeyDown}
  >
    {actions.map((action) => <button
      key={action.id}
      type="button"
      role="menuitem"
      disabled={action.disabled}
      className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-[var(--accent)]/15 focus:bg-[var(--accent)]/15 focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent ${action.danger ? "text-[var(--pink)]" : "text-[var(--paper)]"}`}
      onClick={() => onAction(action.id)}
    >
      <span>{action.label}</span>
      {action.shortcut && <span className="text-[10px] text-[var(--muted)]">{action.shortcut}</span>}
    </button>)}
  </div>;
}
