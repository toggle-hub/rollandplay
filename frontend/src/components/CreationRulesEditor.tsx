import { useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import type { ActionLists } from "../api/types";
import { hasCompendium } from "../lib/actions";
import { creationRulesDraft, parseCreationRules, rulesFromDraft, scoreRange, type ClassDraft, type CreationRulesDraft } from "../lib/creationRulesConfig";
import { AttributeFields } from "./AttributeFields";

const equipmentGroups = [
  { list: "attacks", label: "Weapons" },
  { list: "actions", label: "Spells & abilities" },
  { list: "items", label: "Items" },
] as const;

function NameList({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return <div className="min-w-0 space-y-2">
    {values.map((value, index) => <div className="flex items-end gap-2" key={index}>
      <label className="field-label min-w-0 flex-1">{label} {index + 1}<input value={value} onChange={(e) => onChange(values.map((item, i) => i === index ? e.target.value : item))} /></label>
      <button type="button" className="btn-secondary !px-3" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}><Trash size={18} aria-hidden="true" /></button>
    </div>)}
    <button type="button" className="btn-secondary" onClick={() => onChange([...values, ""])}><Plus size={18} aria-hidden="true" />Add {label.toLowerCase()}</button>
  </div>;
}

type Props = { draft: CreationRulesDraft; compendium: ActionLists; onChange: (draft: CreationRulesDraft) => void };
export function CreationRulesEditor({ draft, compendium, onChange }: Props) {
  const [error, setError] = useState("");
  function switchMode(mode: CreationRulesDraft["mode"]) {
    if (mode === draft.mode) return;
    try {
      onChange(mode === "json" ? { ...draft, mode, json: JSON.stringify(rulesFromDraft(draft), null, 2) } : creationRulesDraft(parseCreationRules(draft.json)));
      setError("");
    } catch (err) { setError(err instanceof SyntaxError ? "Creation rules must be valid JSON." : err instanceof Error ? err.message : "Invalid creation rules."); }
  }
  function updateClass(key: string, changes: Partial<ClassDraft>) {
    onChange({ ...draft, classes: draft.classes.map((cls) => cls.key === key ? { ...cls, ...changes } : cls) });
  }
  /** Adds or removes a compendium id from a class kit, keeping compendium order. */
  function toggleEquipment(cls: ClassDraft, list: keyof ClassDraft["startingEquipment"], id: string, checked: boolean) {
    const picked = new Set(cls.startingEquipment[list]);
    if (checked) picked.add(id); else picked.delete(id);
    const ids = compendium[list].map((entry) => entry.id).filter((entryId) => picked.has(entryId));
    updateClass(cls.key, { startingEquipment: { ...cls.startingEquipment, [list]: ids } });
  }
  function updatePoint(changes: Partial<CreationRulesDraft["point"]>) {
    const point = { ...draft.point, ...changes };
    if (changes.min !== undefined || changes.max !== undefined) {
      const scores = scoreRange(point);
      if (scores.length) point.costs = Object.fromEntries(scores.map((score, index) => [String(score), draft.point.costs[String(score)] ?? String(index)]));
    }
    onChange({ ...draft, point });
  }
  return <section className="min-w-0 space-y-4 border-t border-[var(--line)] pt-5" aria-labelledby="creation-rules-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="creation-rules-heading" className="mb-0 text-lg">Character creation rules</h3><div className="flex gap-2" role="group" aria-label="Creation rules editor mode">
      <button type="button" className={draft.mode === "fields" ? "btn" : "btn-secondary"} aria-pressed={draft.mode === "fields"} onClick={() => switchMode("fields")}>Rule inputs</button>
      <button type="button" className={draft.mode === "json" ? "btn" : "btn-secondary"} aria-pressed={draft.mode === "json"} onClick={() => switchMode("json")}>Rules JSON</button>
    </div></div>
    <p className="text-muted text-sm">Optional rules for choosing a class and distributing points. Leave classes empty and point allocation off for free-form characters.</p>
    {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
    {draft.mode === "json" ? <label className="field-label">Creation rules (JSON)<textarea className="!min-h-80 w-full !font-mono !text-sm" value={draft.json} spellCheck={false} onChange={(e) => onChange({ ...draft, json: e.target.value })} /></label> : <>
      <div className="space-y-3"><h4 className="mb-0 text-base">Classes ({draft.classes.length})</h4>
        {draft.classes.map((cls, index) => <details className="min-w-0 rounded-lg border border-[var(--line)] p-3" key={cls.key}>
          <summary className="cursor-pointer text-[var(--lavender)]">{cls.name || `New class ${index + 1}`}</summary>
          <div className="mt-4 min-w-0 space-y-4">
            <label className="field-label">Class name<input value={cls.name} onChange={(e) => updateClass(cls.key, { name: e.target.value })} /></label>
            <label className="field-label">Class ID<input value={cls.id} onChange={(e) => updateClass(cls.key, { id: e.target.value })} /></label>
            <p className="text-muted text-xs">A stable, unique ID stored with each character. The display name can be different.</p>
            <label className="field-label">Class description<textarea value={cls.description} onChange={(e) => updateClass(cls.key, { description: e.target.value })} /></label>
            <details><summary className="cursor-pointer text-sm text-[var(--lavender)]">Class-granted values ({cls.defaults.length})</summary><div className="mt-3"><AttributeFields fields={cls.defaults} onChange={(defaults) => updateClass(cls.key, { defaults })} /></div></details>
            <p className="text-muted text-xs">Grant values such as hit_die or a group of saving-throw toggles. These override the book defaults and cannot be changed during creation.</p>
            {cls.choices.map((choice) => <fieldset key={choice.key} className="min-w-0 space-y-3 rounded-lg border border-[var(--line)] p-3">
              <legend className="px-1 text-sm">{choice.label || "Choice group"}</legend>
              <label className="field-label">Choice label<input value={choice.label} onChange={(e) => updateClass(cls.key, { choices: cls.choices.map((item) => item.key === choice.key ? { ...item, label: e.target.value } : item) })} /></label>
              <label className="field-label">Choice attribute<input value={choice.attribute} placeholder="skill_proficiencies" onChange={(e) => updateClass(cls.key, { choices: cls.choices.map((item) => item.key === choice.key ? { ...item, attribute: e.target.value } : item) })} /></label>
              <label className="field-label">Number to choose<input type="number" min="1" step="1" value={choice.count} onChange={(e) => updateClass(cls.key, { choices: cls.choices.map((item) => item.key === choice.key ? { ...item, count: e.target.value } : item) })} /></label>
              <NameList label="Option" values={choice.options} onChange={(options) => updateClass(cls.key, { choices: cls.choices.map((item) => item.key === choice.key ? { ...item, options } : item) })} />
              <button type="button" className="btn-secondary" onClick={() => updateClass(cls.key, { choices: cls.choices.filter((item) => item.key !== choice.key) })}>Remove choice group</button>
            </fieldset>)}
            {hasCompendium(compendium) && <fieldset className="min-w-0 space-y-3 rounded-lg border border-[var(--line)] p-3">
              <legend className="px-1 text-sm">Starting equipment</legend>
              <p className="text-muted mb-0 text-xs">Pre-picked for new characters of this class. Players can still uncheck them.</p>
              {equipmentGroups.filter(({ list }) => compendium[list].length > 0).map(({ list, label }) => <fieldset key={list} className="min-w-0 space-y-1">
                <legend className="field-label">{label}</legend>
                <div className="grid gap-1 sm:grid-cols-2">{compendium[list].map((entry) => <label key={entry.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={cls.startingEquipment[list].includes(entry.id)} onChange={(e) => toggleEquipment(cls, list, entry.id, e.target.checked)} />{entry.name}
                </label>)}</div>
              </fieldset>)}
            </fieldset>}
            <div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary" onClick={() => updateClass(cls.key, { choices: [...cls.choices, { key: crypto.randomUUID(), attribute: "", label: "", count: "1", options: [""] }] })}>Add choice group</button>
              <button type="button" className="btn-secondary" onClick={() => onChange({ ...draft, classes: draft.classes.filter((item) => item.key !== cls.key) })}>Remove class</button></div>
          </div>
        </details>)}
        <button type="button" className="btn-secondary" onClick={() => onChange({ ...draft, classes: [...draft.classes, { key: crypto.randomUUID(), id: crypto.randomUUID(), name: "", description: "", defaults: [], choices: [], startingEquipment: { attacks: [], actions: [], items: [] } }] })}><Plus size={18} aria-hidden="true" />Add class</button>
      </div>
      <div className="min-w-0 space-y-4 border-t border-[var(--line)] pt-4">
        <label className="flex items-center gap-3"><input type="checkbox" checked={draft.pointEnabled} onChange={(e) => onChange({ ...draft, pointEnabled: e.target.checked })} />Enable point allocation</label>
        {draft.pointEnabled && <>
          <NameList label="Point attribute" values={draft.point.attributes} onChange={(attributes) => updatePoint({ attributes })} />
          <div className="grid grid-flow-dense gap-3 sm:grid-cols-2">
            <label className="field-label">Minimum score<input type="number" step="1" value={draft.point.min} onChange={(e) => updatePoint({ min: e.target.value })} /></label>
            <label className="field-label">Maximum score<input type="number" step="1" value={draft.point.max} onChange={(e) => updatePoint({ max: e.target.value })} /></label>
            <label className="field-label">Point budget<input type="number" min="0" step="1" value={draft.point.budget} onChange={(e) => updatePoint({ budget: e.target.value })} /></label>
          </div>
          <p className="text-muted text-xs">Set a cumulative cost for each score, not the cost of a single increase. The minimum costs 0; later costs must increase. Up to 100 different scores are supported.</p>
          <div className="grid grid-flow-dense gap-3 sm:grid-cols-3">{scoreRange(draft.point).map((score) => <label key={score} className="field-label">Cost for score {score}<input type="number" min="0" step="1" value={draft.point.costs[String(score)] ?? ""} onChange={(e) => updatePoint({ costs: { ...draft.point.costs, [String(score)]: e.target.value } })} /></label>)}</div>
          <details className="rounded-lg border border-[var(--line)] p-3"><summary className="cursor-pointer text-sm text-[var(--lavender)]">Separate bonus allowance</summary>
            <p className="mt-3 text-muted text-xs">Optional extra points added after buying base scores. Leave both values at 0 for no bonuses. This is a rule-book allowance, not automatic ancestry rules.</p>
            <div className="grid grid-flow-dense gap-3 sm:grid-cols-2"><label className="field-label">Bonus budget<input type="number" min="0" step="1" value={draft.point.bonus_budget} onChange={(e) => updatePoint({ bonus_budget: e.target.value })} /></label>
              <label className="field-label">Bonus cap per attribute<input type="number" min="0" max="100" step="1" value={draft.point.bonus_max} onChange={(e) => updatePoint({ bonus_max: e.target.value })} /></label></div>
          </details>
        </>}
      </div>
    </>}
  </section>;
}
