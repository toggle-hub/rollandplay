import { useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import type { ActionLists } from "../api/types";
import { hasCompendium } from "../lib/actions";
import { objectFromFields } from "../lib/attributeFields";
import { humanizeKey } from "../lib/checks";
import { creationRulesDraft, parseCreationRules, rulesFromDraft, scoreRange, type ClassDraft, type CreationRulesDraft } from "../lib/creationRulesConfig";
import { isYesNoGroup } from "../lib/ruleBooks";
import { AdvancedJson } from "./AdvancedJson";
import { ClassValuesEditor } from "./ClassValuesEditor";

const equipmentGroups = [
  { list: "attacks", label: "Weapons" },
  { list: "actions", label: "Spells & abilities" },
  { list: "items", label: "Items" },
] as const;

type ChoiceDraft = ClassDraft["choices"][number];

function NameList({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return <div className="min-w-0 space-y-2">
    {values.map((value, index) => <div className="flex items-end gap-2" key={index}>
      <label className="field-label min-w-0 flex-1">{label} {index + 1}<input value={value} onChange={(e) => onChange(values.map((item, i) => i === index ? e.target.value : item))} /></label>
      <button type="button" className="btn-secondary !px-3" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}><Trash size={18} aria-hidden="true" /></button>
    </div>)}
    <button type="button" className="btn-secondary" onClick={() => onChange([...values, ""])}><Plus size={18} aria-hidden="true" />Add {label.toLowerCase()}</button>
  </div>;
}

/** The yes/no groups a class can offer as a choice, with their options: the book's, and the class's own values. */
function choiceGroups(attributes: Record<string, unknown>, cls: ClassDraft): Record<string, string[]> {
  let granted: Record<string, unknown> = {};
  try { granted = objectFromFields(cls.defaults); } catch { /* an unfinished value offers nothing extra */ }
  const all = { ...attributes, ...granted };
  return Object.fromEntries(Object.entries(all).filter(([, value]) => isYesNoGroup(value)).map(([key, value]) => [key, Object.keys(value as object)]));
}

type Props = { draft: CreationRulesDraft; attributes: Record<string, unknown>; compendium: ActionLists; onChange: (draft: CreationRulesDraft) => void };
export function CreationRulesEditor({ draft, attributes, compendium, onChange }: Props) {
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
  function updateChoice(cls: ClassDraft, key: string, changes: Partial<ChoiceDraft>) {
    updateClass(cls.key, { choices: cls.choices.map((item) => item.key === key ? { ...item, ...changes } : item) });
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
    <h3 id="creation-rules-heading" className="mb-0 text-lg">Character creation rules</h3>
    <p className="text-muted text-sm">Optional rules for choosing a class and distributing points. Leave classes empty and point allocation off for free-form characters.</p>
    {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
    {draft.mode === "fields" && <>
      <div className="space-y-3"><h4 className="mb-0 text-base">Classes ({draft.classes.length})</h4>
        {draft.classes.map((cls, index) => {
          const groups = choiceGroups(attributes, cls);
          const className = cls.name || `New class ${index + 1}`;
          return <details className="min-w-0 rounded-lg border border-[var(--line)] p-3" key={cls.key}>
            <summary className="cursor-pointer text-[var(--lavender)]">{className}</summary>
            <div className="mt-4 min-w-0 space-y-4">
              <label className="field-label">Class name<input value={cls.name} onChange={(e) => updateClass(cls.key, { name: e.target.value })} /></label>
              <label className="field-label">Class description<textarea value={cls.description} onChange={(e) => updateClass(cls.key, { description: e.target.value })} /></label>
              <fieldset className="min-w-0 space-y-3 rounded-lg border border-[var(--line)] p-3">
                <legend className="px-1 text-sm">Values this class sets ({cls.defaults.length})</legend>
                <p className="text-muted mb-0 text-xs">For example a hit die or saving-throw proficiencies. They replace the book's defaults and can't be changed while creating a character.</p>
                <ClassValuesEditor classLabel={className} fields={cls.defaults} attributes={attributes} onChange={(defaults) => updateClass(cls.key, { defaults })} />
              </fieldset>
              {cls.choices.map((choice) => {
                const options = [...groups[choice.attribute] ?? [], ...choice.options.filter((option) => !groups[choice.attribute]?.includes(option))];
                const groupKeys = Object.keys(groups);
                return <fieldset key={choice.key} className="min-w-0 space-y-3 rounded-lg border border-[var(--line)] p-3">
                  <legend className="px-1 text-sm">{choice.label || "Choice group"}</legend>
                  <label className="field-label">Players choose from
                    <select value={choice.attribute} onChange={(e) => updateChoice(cls, choice.key, { attribute: e.target.value, options: [], label: choice.label || humanizeKey(e.target.value) })}>
                      <option value="">Choose a group</option>
                      {[...groupKeys, ...choice.attribute && !groupKeys.includes(choice.attribute) ? [choice.attribute] : []].map((key) => <option key={key} value={key}>{humanizeKey(key)}</option>)}
                    </select>
                  </label>
                  {groupKeys.length === 0 && <p className="text-muted mb-0 text-xs">Add a group of yes/no values to the character defaults first, for example skill proficiencies.</p>}
                  <label className="field-label">Label players see<input value={choice.label} onChange={(e) => updateChoice(cls, choice.key, { label: e.target.value })} /></label>
                  <label className="field-label">How many they choose<input type="number" min="1" max={Math.max(1, choice.options.length)} step="1" value={choice.count} onChange={(e) => updateChoice(cls, choice.key, { count: e.target.value })} /></label>
                  {choice.attribute && <fieldset className="min-w-0 space-y-1">
                    <legend className="field-label">Options they can pick</legend>
                    <div className="grid gap-1 sm:grid-cols-2">{options.map((option) => <label key={option} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={choice.options.includes(option)} onChange={(e) => {
                        const picked = new Set(choice.options);
                        if (e.target.checked) picked.add(option); else picked.delete(option);
                        updateChoice(cls, choice.key, { options: options.filter((item) => picked.has(item)) });
                      }} />{humanizeKey(option)}
                    </label>)}</div>
                  </fieldset>}
                  <button type="button" className="btn-secondary" onClick={() => updateClass(cls.key, { choices: cls.choices.filter((item) => item.key !== choice.key) })}>Remove choice group</button>
                </fieldset>;
              })}
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
              <div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary" onClick={() => updateClass(cls.key, { choices: [...cls.choices, { key: crypto.randomUUID(), attribute: "", label: "", count: "1", options: [] }] })}>Add choice group</button>
                <button type="button" className="btn-secondary" onClick={() => onChange({ ...draft, classes: draft.classes.filter((item) => item.key !== cls.key) })}>Remove class</button></div>
            </div>
          </details>;
        })}
        <button type="button" className="btn-secondary" onClick={() => onChange({ ...draft, classes: [...draft.classes, { key: crypto.randomUUID(), id: "", name: "", description: "", defaults: [], choices: [], startingEquipment: { attacks: [], actions: [], items: [] } }] })}><Plus size={18} aria-hidden="true" />Add class</button>
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
    <AdvancedJson id="creation-rules-json" label="creation rules" open={draft.mode === "json"} value={draft.json} onToggle={() => switchMode(draft.mode === "json" ? "fields" : "json")} onChange={(json) => onChange({ ...draft, json })} />
  </section>;
}
