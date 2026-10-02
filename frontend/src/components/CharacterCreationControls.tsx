import type { CharacterCreation, CreationRules } from "../api/types";
import { creationLabel } from "../lib/characterCreation";

function grantLabel(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "boolean")) {
    return Object.entries(value).filter(([, enabled]) => enabled).map(([key]) => creationLabel(key)).join(", ") || "None";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

type Props = {
  rules: CreationRules;
  creation: CharacterCreation;
  onChange: (creation: CharacterCreation) => void;
  onClassChange: (id: string) => void;
};

export function CharacterCreationControls({ rules, creation, onChange, onClassChange }: Props) {
  const selected = rules.classes?.find((item) => item.id === creation.class_id);
  const points = rules.point_buy;
  const spent = points?.attributes.reduce((total, key) => total + points.costs[String(creation.scores?.[key] ?? points.min)], 0) ?? 0;
  const bonusSpent = points?.attributes.reduce((total, key) => total + (creation.bonuses?.[key] ?? 0), 0) ?? 0;
  return <div className="min-w-0 space-y-5">
    {!!rules.classes?.length && <section className="min-w-0 space-y-4" aria-labelledby="character-class-heading">
      <h3 id="character-class-heading" className="mb-0 text-lg">Choose your class</h3>
      <label className="field-label" htmlFor="character-class">Class<select id="character-class" value={creation.class_id ?? ""} onChange={(e) => onClassChange(e.target.value)}>
        <option value="" disabled>Choose a class</option>
        {rules.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {selected && <>
        {selected.description && <p className="text-muted text-sm leading-relaxed">{selected.description}</p>}
        {Object.keys(selected.defaults).length > 0 && <div className="rounded-lg border border-[var(--line)] p-4">
          <h4 className="mb-3 text-sm text-[var(--lavender)]">Class-granted values</h4>
          <dl className="space-y-2 text-sm">{Object.entries(selected.defaults).map(([key, value]) => <div className="flex flex-wrap justify-between gap-x-4 gap-y-1" key={key}><dt className="text-muted">{creationLabel(key)}</dt><dd className="min-w-0 break-words">{grantLabel(value)}</dd></div>)}</dl>
          <p className="mb-0 mt-3 text-muted text-xs">Applied automatically. Hit points and other derived values still need to be set for your character.</p>
        </div>}
        {(selected.choices ?? []).map((choice) => {
          const chosen = creation.choices?.[choice.attribute] ?? [];
          return <fieldset key={choice.attribute} className="min-w-0 rounded-lg border border-[var(--line)] p-4">
            <legend className="px-1 text-sm text-[var(--lavender)]">{choice.label}</legend>
            <p className="text-muted text-sm" aria-live="polite">Choose {choice.count} · {chosen.length} selected</p>
            <div className="grid grid-flow-dense gap-3 sm:grid-cols-2">{choice.options.map((option) => <label key={option} className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={chosen.includes(option)} disabled={!chosen.includes(option) && chosen.length >= choice.count} onChange={(e) => onChange({ ...creation, choices: { ...creation.choices, [choice.attribute]: e.target.checked ? [...chosen, option] : chosen.filter((value) => value !== option) } })} />{creationLabel(option)}
            </label>)}</div>
          </fieldset>;
        })}
      </>}
    </section>}
    {points && <section className="min-w-0 space-y-4 border-t border-[var(--line)] pt-5" aria-labelledby="point-buy-heading">
      <div className="flex flex-wrap items-start justify-between gap-3"><h3 id="point-buy-heading" className="mb-0 text-lg">Distribute your points</h3><output className={`rounded-lg border border-[var(--line)] px-3 py-2 text-sm ${spent > points.budget ? "text-[var(--pink)]" : "text-[var(--green)]"}`} aria-live="polite">{points.budget - spent} / {points.budget} points remaining</output></div>
      <p className="text-muted text-sm leading-relaxed">Base scores start at {points.min}, up to {points.max}. Higher scores may cost more than one point. Unspent points are allowed.</p>
      {points.bonus_budget > 0 ? <p className="text-sm text-[var(--lavender)]" aria-live="polite">Bonus allowance: {points.bonus_budget - bonusSpent} / {points.bonus_budget} remaining · up to +{points.bonus_max} per attribute. Bonuses do not spend base-score points.</p> : <p className="text-muted text-xs">No bonus points are configured. Ancestry or other bonuses are not included; extend the rule book to define a separate allowance.</p>}
      <div className="grid grid-flow-dense gap-3 sm:grid-cols-2">{points.attributes.map((attribute) => {
        const score = creation.scores?.[attribute] ?? points.min;
        const bonus = creation.bonuses?.[attribute] ?? 0;
        return <div key={attribute} className="min-w-0 space-y-3 rounded-lg border border-[var(--line)] p-3">
          <div className="flex items-center justify-between gap-3"><h4 className="mb-0 text-sm text-[var(--lavender)]">{creationLabel(attribute)}</h4><output className="text-lg" aria-label={`${creationLabel(attribute)} final score`}>{score + bonus}</output></div>
          <label className="field-label">{creationLabel(attribute)} base score<select value={score} onChange={(e) => onChange({ ...creation, scores: { ...creation.scores, [attribute]: Number(e.target.value) } })}>
            {Array.from({ length: points.max - points.min + 1 }, (_, index) => points.min + index).map((value) => <option key={value} value={value} disabled={spent - points.costs[String(score)] + points.costs[String(value)] > points.budget}>{value} · {points.costs[String(value)]} points</option>)}
          </select></label>
          {points.bonus_budget > 0 && <label className="field-label">{creationLabel(attribute)} bonus<select value={bonus} onChange={(e) => onChange({ ...creation, bonuses: { ...creation.bonuses, [attribute]: Number(e.target.value) } })}>
            {Array.from({ length: points.bonus_max + 1 }, (_, value) => <option key={value} value={value} disabled={bonusSpent - bonus + value > points.bonus_budget}>+{value}</option>)}
          </select></label>}
        </div>;
      })}</div>
    </section>}
  </div>;
}
