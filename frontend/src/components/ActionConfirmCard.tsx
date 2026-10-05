import { useEffect, useRef, useState } from "react";
import { DiceFive } from "@phosphor-icons/react";
import { normalRoll, type RollOptions } from "../lib/rolls";
import { RollOptionsControl } from "./RollOptionsControl";

type Props = {
  title: string;
  subtitle: string;
  lines: string[];
  /** Offer advantage, disadvantage and a one-off bonus: for attack rolls, checks and death saves. */
  rollOptions?: boolean;
  onRoll: (options: RollOptions) => void;
  onBack?: () => void;
  onCancel: () => void;
};

export function ActionConfirmCard({ title, subtitle, lines, rollOptions, onRoll, onBack, onCancel }: Props) {
  const rollButton = useRef<HTMLButtonElement>(null);
  const [options, setOptions] = useState<RollOptions>(normalRoll);

  useEffect(() => {
    rollButton.current?.focus({ preventScroll: true });
  }, []);

  return <div
    className="absolute left-1/2 top-3 z-30 w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 space-y-2 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-xs text-[var(--paper)] shadow-xl"
    role="dialog"
    aria-label={`Confirm ${title}`}
    onPointerDown={(event) => event.stopPropagation()}
    onContextMenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
    }}
    onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }}
  >
    <div>
      <p className="mb-0 text-sm font-medium">{title}</p>
      <p className="mb-0 text-[var(--muted)]">{subtitle}</p>
    </div>
    <ul className="space-y-0.5">
      {lines.map((line, index) => <li key={index}>{line}</li>)}
    </ul>
    {rollOptions && <RollOptionsControl value={options} onChange={setOptions} label={`${title} roll options`} />}
    <div className="flex flex-wrap justify-end gap-2">
      {onBack && <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={onBack}>Back</button>}
      <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={onCancel}>Cancel</button>
      <button ref={rollButton} className="btn min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => onRoll(rollOptions ? options : normalRoll)}>
        <DiceFive size={16} aria-hidden="true" />Roll
      </button>
    </div>
  </div>;
}
