import { FormEvent, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { conditionKeys, conditionLabel, maxConditionLength, maxConditions, withCondition } from "../lib/conditions";

type Props = {
  tokenId: string;
  conditions: readonly string[];
  busy: boolean;
  /** Saves the whole new list; the table sees it at once. */
  onChange: (conditions: string[]) => void;
};

/** Conditions on a token: pick a 5e condition, type your own, or remove one. Each change saves. */
export function ConditionsEditor({ tokenId, conditions, busy, onChange }: Props) {
  const [custom, setCustom] = useState("");
  const full = conditions.length >= maxConditions;
  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    const next = withCondition(conditions, custom);
    if (next.length > conditions.length) onChange(next);
    setCustom("");
  };
  return <div className="space-y-2">
    <p className="field-label" id={`token-conditions-${tokenId}`}>Conditions <span className="text-muted font-normal">(everyone sees these)</span></p>
    {conditions.length === 0
      ? <p className="text-muted text-sm">No conditions.</p>
      : <ul className="flex flex-wrap gap-1.5" aria-labelledby={`token-conditions-${tokenId}`}>
        {conditions.map((condition) => <li key={condition} className="inline-flex items-center gap-1 rounded-full border border-[var(--lavender)]/40 bg-[var(--lavender)]/10 py-0.5 pl-2.5 pr-1 text-xs text-[var(--lavender)]">
          {conditionLabel(condition)}
          <button className="grid size-5 place-items-center rounded-full hover:bg-[var(--lavender)]/20" type="button" disabled={busy}
            aria-label={`Remove ${conditionLabel(condition)}`} onClick={() => onChange(conditions.filter((item) => item !== condition))}>
            <X size={12} weight="bold" aria-hidden="true" />
          </button>
        </li>)}
      </ul>}
    <label className="sr-only" htmlFor={`token-condition-pick-${tokenId}`}>Add a condition</label>
    <select id={`token-condition-pick-${tokenId}`} className="w-full min-w-0" value="" disabled={busy || full}
      onChange={(event) => event.target.value && onChange(withCondition(conditions, event.target.value))}>
      <option value="">{full ? `At most ${maxConditions} conditions` : "Add a condition…"}</option>
      {conditionKeys.filter((key) => !conditions.includes(key)).map((key) => <option key={key} value={key}>{conditionLabel(key)}</option>)}
    </select>
    <form className="flex gap-2" onSubmit={addCustom}>
      <label className="sr-only" htmlFor={`token-condition-custom-${tokenId}`}>Your own condition</label>
      <input id={`token-condition-custom-${tokenId}`} className="w-full min-w-0" maxLength={maxConditionLength} placeholder="Or type your own" value={custom}
        disabled={busy || full} onChange={(event) => setCustom(event.target.value)} />
      <button className="btn-secondary min-h-0 shrink-0 px-3" type="submit" disabled={busy || full || !custom.trim()} aria-label="Add your own condition"><Plus size={16} aria-hidden="true" /></button>
    </form>
  </div>;
}
