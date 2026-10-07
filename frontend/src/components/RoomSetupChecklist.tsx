import { useMemo, useState } from "react";
import { CheckCircle, Circle } from "@phosphor-icons/react";

type Props = {
  hasMap: boolean;
  hasTokens: boolean;
  hasPlayers: boolean;
  onOpenMapTools: () => void;
  onOpenTokenTools: () => void;
  onOpenPlayers: () => void;
  onHide: () => void;
};

// ".btn" is unlayered CSS, so the compact sizing needs important utilities.
const smallButton = "btn-secondary min-h-8! shrink-0 gap-1.5! px-3! py-1! text-xs!";

/** The game master's first-session steps above the map: choose a map, place tokens, invite players. */
export function RoomSetupChecklist({ hasMap, hasTokens, hasPlayers, onOpenMapTools, onOpenTokenTools, onOpenPlayers, onHide }: Props) {
  const steps = [
    { label: "Choose or start a map", done: hasMap, action: "Open map tools", onAction: onOpenMapTools },
    { label: "Place tokens for players and monsters", done: hasTokens, action: "Open token tools", onAction: onOpenTokenTools },
    { label: "Invite your players", done: hasPlayers, action: "Show invite", onAction: onOpenPlayers },
  ];
  return <section aria-label="Set up your table" className="shrink-0 space-y-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--input)] px-3 py-2">
    <div className="flex items-center justify-between gap-2">
      <h2 className="mb-0 text-sm font-medium">Set up your table</h2>
      <button className={smallButton} type="button" onClick={onHide}>Hide</button>
    </div>
    <ol className="m-0 list-none space-y-1.5 p-0">
      {steps.map((step) => <li key={step.label} className="flex flex-wrap items-center gap-2 text-sm">
        {step.done
          ? <CheckCircle size={18} weight="fill" className="shrink-0 text-[var(--green)]" aria-label="Done" />
          : <Circle size={18} className="shrink-0 text-[var(--muted)]" aria-label="To do" />}
        <span className={step.done ? "text-[var(--muted)]" : "text-[var(--paper)]"}>{step.label}</span>
        {!step.done && <button className={smallButton} type="button" onClick={step.onAction}>{step.action}</button>}
      </li>)}
    </ol>
    <p className="mb-0 text-xs text-[var(--muted)]">When a fight starts, press Start combat.</p>
  </section>;
}

/** Whether the game master hid the checklist in this room, remembered per browser. */
export function useSetupHidden(roomId: string): [hidden: boolean, hide: () => void] {
  const key = `rollandplay.setupHidden.${roomId}`;
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const stored = useMemo(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }, [key]);
  function hide() {
    try {
      localStorage.setItem(key, "1");
    } catch {
      // Storage is off; the checklist stays hidden until the page reloads.
    }
    setHiddenKey(key);
  }
  return [stored || hiddenKey === key, hide];
}
