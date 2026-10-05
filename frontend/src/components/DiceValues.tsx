import type { RollResult } from "../api/types";

const keepLabel = { kh: "keep highest", kl: "keep lowest" } as const;

/** Each die rolled, with dropped dice of a keep term (advantage, disadvantage, 4d6kh3) struck through. */
export function DiceValues({ roll, className = "mb-0 mt-1 text-xs text-[var(--muted)]" }: { roll: RollResult; className?: string }) {
  return <p className={className}>
    {roll.dice.map((die, index) => <span key={index}>
      d{die.sides}{die.keep && ` ${keepLabel[die.keep]}`} [{die.values.map((value, valueIndex) => {
        const dropped = die.kept ? !die.kept[valueIndex] : false;
        return <span key={valueIndex}>
          {valueIndex > 0 && ", "}
          {dropped
            ? <s className="opacity-60" title="Dropped">{value}<span className="sr-only"> dropped</span></s>
            : die.kept ? <strong className="font-semibold text-[var(--paper)]" title="Kept">{value}</strong> : value}
        </span>;
      })}]{" "}
    </span>)}
    <span>· modifier {roll.modifier}</span>
  </p>;
}
