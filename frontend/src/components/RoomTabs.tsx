import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type RoomTab = {
  id: string;
  label: string;
  /** A count shown next to the label, e.g. open checks; hidden at 0. */
  count?: number;
  content: ReactNode;
};

type Props = {
  /** Names the tab list for assistive technology. */
  label: string;
  /** Makes tab and panel ids unique on the page. */
  idPrefix: string;
  tabs: RoomTab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  panelClassName?: string;
};

/**
 * Tabs for the room's side columns. Every panel stays mounted while hidden, so a half-typed chat
 * message or form keeps its text. Arrow keys, Home and End move between tabs.
 */
export function RoomTabs({ label, idPrefix, tabs, active, onChange, className = "", panelClassName = "" }: Props) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === active);
    const target = event.key === "ArrowRight" ? index + 1
      : event.key === "ArrowLeft" ? index - 1
        : event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : null;
    if (target === null) return;
    event.preventDefault();
    const next = tabs[(target + tabs.length) % tabs.length];
    onChange(next.id);
    buttons.current.get(next.id)?.focus();
  }

  return <div className={`flex min-h-0 flex-col gap-3 ${className}`}>
    <div role="tablist" aria-label={label} className="flex shrink-0 gap-1 rounded-lg border border-[var(--line)] bg-[var(--input)] p-1" onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return <button
          key={tab.id}
          ref={(element) => {
            if (element) buttons.current.set(tab.id, element);
            else buttons.current.delete(tab.id);
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.id}`}
          aria-selected={selected}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={selected ? 0 : -1}
          className={`inline-flex min-h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${selected ? "bg-[var(--surface-raised)] text-[var(--paper)] shadow-[inset_0_-2px_var(--accent)]" : "text-[var(--muted)] hover:text-[var(--lavender)]"}`}
          onClick={() => onChange(tab.id)}
        >
          <span className="truncate">{tab.label}</span>
          {!!tab.count && <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold leading-4 text-[var(--ink)]">{tab.count}</span>}
        </button>;
      })}
    </div>
    {tabs.map((tab) => <div
      key={tab.id}
      role="tabpanel"
      id={`${idPrefix}-panel-${tab.id}`}
      aria-labelledby={`${idPrefix}-tab-${tab.id}`}
      hidden={tab.id !== active}
      className={tab.id === active ? panelClassName : undefined}
    >
      {tab.content}
    </div>)}
  </div>;
}
