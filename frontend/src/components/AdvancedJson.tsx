import type { ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";

type Props = {
  id: string;
  /** What the JSON holds, e.g. "character defaults". */
  label: string;
  open: boolean;
  value: string;
  help?: ReactNode;
  onToggle: () => void;
  onChange: (value: string) => void;
};

/** A closed-by-default "Advanced" disclosure for editing raw JSON; while it is open the JSON replaces the inputs. */
export function AdvancedJson({ id, label, open, value, help, onToggle, onChange }: Props) {
  return <div className="min-w-0 rounded-lg border border-[var(--line)] p-3">
    <button type="button" className="flex w-full items-center justify-between gap-3 text-left text-sm text-[var(--lavender)]" aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <span>Advanced: edit {label} as JSON</span>
      <CaretDown size={16} className={open ? "rotate-180" : ""} aria-hidden="true" />
    </button>
    {open && <div id={id} className="mt-3 space-y-2">
      <label className="field-label">{label.charAt(0).toUpperCase() + label.slice(1)} (JSON)
        <textarea className="!min-h-80 w-full !font-mono !text-sm" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      {help}
      <p className="text-muted mb-0 text-xs">Close Advanced to go back to the inputs; your changes carry over.</p>
    </div>}
  </div>;
}
