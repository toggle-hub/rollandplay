import { useId } from "react";
import { clampBonus, maxRollBonus, rollOptionsHint, type RollMode, type RollOptions } from "../lib/rolls";

const modes: { mode: RollMode; label: string }[] = [
  { mode: "disadvantage", label: "Disadvantage" },
  { mode: "normal", label: "Normal" },
  { mode: "advantage", label: "Advantage" },
];

/** Advantage / Normal / Disadvantage and a one-off bonus for the next d20 roll. */
export function RollOptionsControl({ value, onChange, label = "Roll options" }: { value: RollOptions; onChange: (value: RollOptions) => void; label?: string }) {
  const bonusId = useId();
  return <fieldset className="space-y-1.5">
    <legend className="sr-only">{label}</legend>
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-md border border-[var(--paper)]/15" role="group" aria-label="Advantage or disadvantage">
        {modes.map(({ mode, label: modeLabel }) => <button
          key={mode}
          type="button"
          aria-pressed={value.mode === mode}
          className={`px-2 py-1 text-xs transition-colors ${value.mode === mode ? "bg-[var(--accent)] text-[var(--ink)]" : "text-[var(--paper)] hover:bg-[var(--paper)]/10"}`}
          onClick={() => onChange({ ...value, mode })}
        >{modeLabel}</button>)}
      </div>
      <label className="inline-flex items-center gap-1.5 text-xs! text-[var(--muted)]" htmlFor={bonusId}>
        Bonus
        <input id={bonusId} className="w-14 px-1.5! py-1! text-xs!" type="number" min={-maxRollBonus} max={maxRollBonus} step="1"
          value={value.bonus === 0 ? "" : value.bonus} placeholder="±0"
          onChange={(event) => onChange({ ...value, bonus: event.target.value === "" ? 0 : clampBonus(Number(event.target.value)) })} />
      </label>
    </div>
    <p className="mb-0 text-[11px] text-[var(--muted)]">{rollOptionsHint(value)}</p>
  </fieldset>;
}
