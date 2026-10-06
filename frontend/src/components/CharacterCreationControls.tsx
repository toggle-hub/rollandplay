import type { ReactNode } from "react";
import { Minus, Plus } from "@phosphor-icons/react";
import type { CharacterCreation, CreationRules } from "../api/types";
import { dndAbilities } from "../lib/attacks";
import { creationLabel, type CreationErrorGroup } from "../lib/characterCreation";
import { abilityModifier, describeValue, signed } from "../lib/characterStats";

/** The inline error for a creation field, linked by id from the field's aria-describedby. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} role="alert" tabIndex={-1} className="mb-0 mt-1 text-sm text-[var(--pink)]">{message}</p>;
}

function Stepper({ label, value, canDecrease, canIncrease, onStep, children }: { label: string; value: string; canDecrease: boolean; canIncrease: boolean; onStep: (delta: 1 | -1) => void; children?: ReactNode }) {
  return <div className="space-y-1">
    <p className="field-label mb-0">{label}</p>
    <div role="group" aria-label={label} className="flex items-center gap-3">
      <button type="button" className="btn-secondary !min-h-10 !px-3 disabled:cursor-not-allowed" aria-label={`Decrease ${label}`} disabled={!canDecrease} onClick={() => onStep(-1)}><Minus size={16} aria-hidden="true" /></button>
      <output className="min-w-8 text-center text-lg" aria-live="polite">{value}</output>
      <button type="button" className="btn-secondary !min-h-10 !px-3 disabled:cursor-not-allowed" aria-label={`Increase ${label}`} disabled={!canIncrease} onClick={() => onStep(1)}><Plus size={16} aria-hidden="true" /></button>
    </div>
    {children}
  </div>;
}

type Props = {
  rules: CreationRules;
  creation: CharacterCreation;
  /** The error message for a group, if it has one. */
  errorFor: (group: CreationErrorGroup) => string | undefined;
  onChange: (creation: CharacterCreation) => void;
};

export function ClassControls({ rules, creation, errorFor, onChange, onClassChange }: Props & { onClassChange: (id: string) => void }) {
  const selected = rules.classes?.find((item) => item.id === creation.class_id);
  const classError = errorFor("class");
  return <div className="min-w-0 space-y-4">
    <div>
      <label className="field-label" htmlFor="character-class">Class<select id="character-class" value={creation.class_id ?? ""} aria-invalid={!!classError} aria-describedby={classError ? "character-class-error" : undefined} onChange={(e) => onClassChange(e.target.value)}>
        <option value="" disabled>Choose a class</option>
        {rules.classes?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <FieldError id="character-class-error" message={classError} />
    </div>
    {selected && <>
      {selected.description && <p className="text-muted text-sm leading-relaxed">{selected.description}</p>}
      {Object.keys(selected.defaults).length > 0 && <div className="rounded-lg border border-[var(--line)] p-4">
        <h4 className="mb-3 text-sm text-[var(--lavender)]">From your class</h4>
        <dl className="space-y-2 text-sm">{Object.entries(selected.defaults).map(([key, value]) => <div className="flex flex-wrap justify-between gap-x-4 gap-y-1" key={key}><dt className="text-muted">{creationLabel(key)}</dt><dd className="min-w-0 break-words">{describeValue(key, value)}</dd></div>)}</dl>
        <p className="mb-0 mt-3 text-muted text-xs">Applied automatically.</p>
      </div>}
      {(selected.choices ?? []).map((choice) => {
        const chosen = creation.choices?.[choice.attribute] ?? [];
        const message = errorFor(`choice:${choice.attribute}`);
        const errorId = `choice-${choice.attribute}-error`;
        return <fieldset key={choice.attribute} className="min-w-0 rounded-lg border border-[var(--line)] p-4" aria-describedby={message ? errorId : undefined}>
          <legend className="px-1 text-sm text-[var(--lavender)]">{choice.label}</legend>
          <p className="text-muted text-sm" aria-live="polite">Choose {choice.count} · {chosen.length} selected</p>
          <div className="grid grid-flow-dense gap-3 sm:grid-cols-2">{choice.options.map((option, index) => <label key={option} className="flex items-center gap-3 text-sm">
            <input id={`choice-${choice.attribute}-${index}`} type="checkbox" checked={chosen.includes(option)} disabled={!chosen.includes(option) && chosen.length >= choice.count} onChange={(e) => onChange({ ...creation, choices: { ...creation.choices, [choice.attribute]: e.target.checked ? [...chosen, option] : chosen.filter((value) => value !== option) } })} />{creationLabel(option)}
          </label>)}</div>
          <FieldError id={errorId} message={message} />
        </fieldset>;
      })}
    </>}
  </div>;
}

export function PointBuyControls({ rules, creation, errorFor, onChange }: Props) {
  const points = rules.point_buy;
  if (!points) return null;
  const spent = points.attributes.reduce((total, key) => total + points.costs[String(creation.scores?.[key] ?? points.min)], 0);
  const bonusSpent = points.attributes.reduce((total, key) => total + (creation.bonuses?.[key] ?? 0), 0);
  return <section className="min-w-0 space-y-4" aria-labelledby="point-buy-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><h4 id="point-buy-heading" className="mb-0 text-lg">Ability scores</h4><output className={`rounded-lg border border-[var(--line)] px-3 py-2 text-sm ${spent > points.budget ? "text-[var(--pink)]" : "text-[var(--green)]"}`} aria-live="polite">{points.budget - spent} / {points.budget} points remaining</output></div>
    <FieldError id="point-buy-error" message={errorFor("points")} />
    <p className="text-muted text-sm leading-relaxed">Scores start at {points.min} and go up to {points.max}. Higher scores cost more points. You don’t have to spend them all.</p>
    {points.bonus_budget > 0
      ? <p className="text-sm text-[var(--lavender)]" aria-live="polite">Bonus points: {points.bonus_budget - bonusSpent} of {points.bonus_budget} left, up to +{points.bonus_max} per score. Use them for your ancestry’s increases (for example +2 and +1); they don’t cost points.</p>
      : <p className="text-muted text-xs">This rule book has no bonus points.</p>}
    <div className="grid grid-flow-dense gap-3 sm:grid-cols-2">{points.attributes.map((attribute) => {
      const score = creation.scores?.[attribute] ?? points.min;
      const bonus = creation.bonuses?.[attribute] ?? 0;
      const label = creationLabel(attribute);
      return <div key={attribute} className="min-w-0 space-y-3 rounded-lg border border-[var(--line)] p-3">
        <div className="flex items-baseline justify-between gap-3"><h5 className="mb-0 text-sm text-[var(--lavender)]">{label}</h5>
          <p className="mb-0 flex items-baseline gap-2"><output className="text-lg" aria-label={`${label} final score`}>{score + bonus}</output>
            {dndAbilities.includes(attribute) && <span className="text-muted text-sm" aria-label={`${label} modifier`}>{signed(abilityModifier(score + bonus))}</span>}</p>
        </div>
        <Stepper label={`${label} base score`} value={String(score)}
          canDecrease={score > points.min}
          canIncrease={score < points.max && spent - points.costs[String(score)] + points.costs[String(score + 1)] <= points.budget}
          onStep={(delta) => onChange({ ...creation, scores: { ...creation.scores, [attribute]: score + delta } })}>
          <p className="mb-0 text-muted text-xs">{points.costs[String(score)]} points spent</p>
        </Stepper>
        {points.bonus_budget > 0 && <Stepper label={`${label} bonus`} value={`+${bonus}`}
          canDecrease={bonus > 0}
          canIncrease={bonus < points.bonus_max && bonusSpent < points.bonus_budget}
          onStep={(delta) => onChange({ ...creation, bonuses: { ...creation.bonuses, [attribute]: bonus + delta } })} />}
      </div>;
    })}</div>
  </section>;
}
