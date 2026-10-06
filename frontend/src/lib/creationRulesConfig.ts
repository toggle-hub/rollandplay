import type { ActionLists, CreationRules } from "../api/types";
import { fieldFromValue, objectFromFields, parseAttributes, type Field } from "./attributeFields";
import { uniqueSlug } from "./ruleBooks";

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new Error(`${label}: unknown field “${unknown}”.`);
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonblank text.`);
}
function integer(value: unknown, label: string, minimum?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) throw new Error(`${label} must be an integer${minimum === undefined ? "" : ` of at least ${minimum}`}.`);
}
function names(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} needs at least one entry.`);
  const seen = new Set<string>();
  value.forEach((name) => {
    text(name, label);
    if (seen.has(name)) throw new Error(`${label}: “${name}” is repeated.`);
    seen.add(name);
  });
}

const equipmentLists = ["attacks", "actions", "items"] as const;

export function validateCreationRules(value: unknown, attributes?: Record<string, unknown>, compendium?: ActionLists): CreationRules {
  const rules = object(value, "Creation rules");
  keys(rules, ["classes", "point_buy"], "Creation rules");
  const classIds = new Set<string>();
  const classNames = new Set<string>();
  const owned = new Set<string>(["class"]);
  if (rules.classes !== undefined) {
    if (!Array.isArray(rules.classes)) throw new Error("Classes must be a list.");
    rules.classes.forEach((entry, index) => {
      const label = `Class ${index + 1}`;
      const cls = object(entry, label);
      keys(cls, ["id", "name", "description", "defaults", "choices", "starting_equipment", "spell_list"], label);
      text(cls.id, `${label} ID`);
      text(cls.name, `${label} name`);
      if (classIds.has(cls.id) || classNames.has(cls.name)) throw new Error(`${label}: class IDs and names must be unique.`);
      classIds.add(cls.id); classNames.add(cls.name);
      if (cls.description !== undefined && typeof cls.description !== "string") throw new Error(`${label} description must be text.`);
      const defaults = object(cls.defaults, `${label} defaults`);
      if (Object.hasOwn(defaults, "class")) throw new Error(`${label}: “class” is set from the class name; remove it from defaults.`);
      Object.keys(defaults).forEach((key) => { text(key, `${label} default attribute`); owned.add(key); });
      if (equipmentLists.some((list) => Object.hasOwn(defaults, list))) throw new Error(`${label}: give attacks, spells and items as starting equipment, not defaults.`);
      if (cls.starting_equipment !== undefined) {
        const kit = object(cls.starting_equipment, `${label} starting equipment`);
        keys(kit, [...equipmentLists], `${label} starting equipment`);
        for (const list of equipmentLists) {
          if (kit[list] === undefined) continue;
          if (!Array.isArray(kit[list])) throw new Error(`${label} starting equipment ${list} must be a list.`);
          const seen = new Set<string>();
          for (const id of kit[list]) {
            text(id, `${label} starting equipment entry`);
            if (seen.has(id)) throw new Error(`${label}: starting equipment repeats “${id}”.`);
            seen.add(id);
            if (compendium && !compendium[list].some((entry) => entry.id === id)) throw new Error(`${label}: starting equipment “${id}” is not in the compendium.`);
          }
        }
      }
      if (cls.spell_list !== undefined) {
        if (!Array.isArray(cls.spell_list)) throw new Error(`${label} spell list must be a list.`);
        const seen = new Set<string>();
        for (const id of cls.spell_list) {
          text(id, `${label} spell list entry`);
          if (seen.has(id)) throw new Error(`${label}: spell list repeats “${id}”.`);
          seen.add(id);
          if (compendium && !compendium.actions.some((entry) => entry.id === id)) throw new Error(`${label}: spell “${id}” is not in the compendium.`);
        }
      }
      if (cls.choices !== undefined) {
        if (!Array.isArray(cls.choices)) throw new Error(`${label} choices must be a list.`);
        const choiceNames = new Set<string>();
        cls.choices.forEach((entry, choiceIndex) => {
          const choiceLabel = `${label}, choice group ${choiceIndex + 1}`;
          const choice = object(entry, choiceLabel);
          keys(choice, ["attribute", "label", "count", "options"], choiceLabel);
          text(choice.attribute, `${choiceLabel} attribute`);
          text(choice.label, `${choiceLabel} label`);
          if (choice.attribute === "class" || choiceNames.has(choice.attribute)) throw new Error(`${choiceLabel}: use a unique attribute other than “class”.`);
          choiceNames.add(choice.attribute); owned.add(choice.attribute);
          names(choice.options, `${choiceLabel} options`);
          integer(choice.count, `${choiceLabel} selection count`, 1);
          if (choice.count > choice.options.length) throw new Error(`${choiceLabel}: selection count exceeds available options.`);
          const baseline = Object.hasOwn(defaults, choice.attribute) ? defaults[choice.attribute] : attributes?.[choice.attribute];
          if (baseline !== undefined && Object.values(object(baseline, `${choiceLabel} default`)).some((item) => typeof item !== "boolean")) throw new Error(`${choiceLabel}: the default group must contain only yes / no values.`);
        });
      }
    });
  }
  if (rules.point_buy !== undefined) {
    const point = object(rules.point_buy, "Point allocation");
    keys(point, ["attributes", "min", "max", "budget", "costs", "bonus_budget", "bonus_max"], "Point allocation");
    names(point.attributes, "Point allocation attributes");
    point.attributes.forEach((name) => {
      if (owned.has(name)) throw new Error(`Point attribute “${name}” overlaps a class default, choice group, or reserved class field.`);
    });
    integer(point.min, "Minimum score"); integer(point.max, "Maximum score");
    if (point.max < point.min || point.max - point.min >= 100) throw new Error("Score range must contain between 1 and 100 scores.");
    integer(point.budget, "Point budget", 0);
    integer(point.bonus_budget, "Bonus budget", 0);
    integer(point.bonus_max, "Per-score bonus cap", 0);
    if (point.min < -1000000 || point.max > 1000000 || point.budget > 1000000 || point.bonus_budget > 1000000 || point.bonus_max > 100) throw new Error("Scores and budgets must be within one million; bonus cap must be at most 100.");
    const costs = object(point.costs, "Score costs");
    const scores = Array.from({ length: point.max - point.min + 1 }, (_, index) => String((point.min as number) + index));
    keys(costs, scores, "Score costs");
    let previous = -1;
    for (const score of scores) {
      const cost = costs[score];
      integer(cost, `Cost for score ${score}`, 0);
      if (cost > 1000000) throw new Error(`Cost for score ${score} must be at most one million.`);
      if (score === String(point.min) && cost !== 0) throw new Error("The minimum score must cost 0 points.");
      if (cost <= previous) throw new Error(`Cost for score ${score} must exceed the previous score's cumulative cost.`);
      previous = cost;
    }
  }
  return rules as CreationRules;
}

export function parseCreationRules(json: string, attributes?: Record<string, unknown>, compendium?: ActionLists): CreationRules {
  return validateCreationRules(parseAttributes(json, "Creation rules"), attributes, compendium);
}

type ChoiceDraft = { key: string; attribute: string; label: string; count: string; options: string[] };
/** `spellList` keeps a class's `spell_list` (absent: every spell) through field editing. */
export type ClassDraft = { key: string; id: string; name: string; description: string; defaults: Field[]; choices: ChoiceDraft[]; startingEquipment: { attacks: string[]; actions: string[]; items: string[] }; spellList?: string[] };
type PointDraft = { attributes: string[]; min: string; max: string; budget: string; costs: Record<string, string>; bonus_budget: string; bonus_max: string };
export type CreationRulesDraft = { mode: "fields" | "json"; json: string; classes: ClassDraft[]; pointEnabled: boolean; point: PointDraft };

export function creationRulesDraft(rules: CreationRules = {}): CreationRulesDraft {
  const point = rules.point_buy;
  return {
    mode: "fields", json: "",
    classes: (rules.classes ?? []).map((cls) => ({
      key: crypto.randomUUID(), id: cls.id, name: cls.name, description: cls.description ?? "", defaults: Object.entries(cls.defaults).map(([key, value]) => fieldFromValue(key, value)),
      choices: (cls.choices ?? []).map((choice) => ({ ...choice, key: crypto.randomUUID(), count: String(choice.count), options: [...choice.options] })),
      startingEquipment: { attacks: [...cls.starting_equipment?.attacks ?? []], actions: [...cls.starting_equipment?.actions ?? []], items: [...cls.starting_equipment?.items ?? []] },
      ...(cls.spell_list ? { spellList: [...cls.spell_list] } : {}),
    })),
    pointEnabled: point !== undefined,
    point: point ? { attributes: [...point.attributes], min: String(point.min), max: String(point.max), budget: String(point.budget), costs: Object.fromEntries(Object.entries(point.costs).map(([score, cost]) => [score, String(cost)])), bonus_budget: String(point.bonus_budget), bonus_max: String(point.bonus_max) } : { attributes: [], min: "0", max: "5", budget: "10", costs: { "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5" }, bonus_budget: "0", bonus_max: "0" },
  };
}

export function scoreRange(point: Pick<PointDraft, "min" | "max">): number[] {
  if (!point.min.trim() || !point.max.trim()) return [];
  const min = Number(point.min), max = Number(point.max);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || max - min >= 100) return [];
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}
function draftInteger(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label}: enter an integer.`);
  const number = Number(value);
  integer(number, label);
  return number;
}

/** A class without an id (a new one) gets one from its name; saved classes keep theirs when renamed. */
export function rulesFromDraft(draft: CreationRulesDraft, attributes?: Record<string, unknown>, compendium?: ActionLists): CreationRules {
  if (draft.mode === "json") return parseCreationRules(draft.json, attributes, compendium);
  const rules: CreationRules = {};
  const taken = new Set(draft.classes.map((cls) => cls.id).filter(Boolean));
  const classIds = draft.classes.map((cls) => {
    const id = cls.id || uniqueSlug(cls.name, taken, "class");
    taken.add(id);
    return id;
  });
  if (draft.classes.length) rules.classes = draft.classes.map((cls, index) => ({
    id: classIds[index], name: cls.name, ...(cls.description ? { description: cls.description } : {}), defaults: objectFromFields(cls.defaults, `${cls.name || "Class"} defaults`),
    choices: cls.choices.map((choice) => ({ attribute: choice.attribute, label: choice.label, count: draftInteger(choice.count, `${choice.label || "Choice group"} selection count`), options: [...choice.options] })),
    ...(equipmentLists.some((list) => cls.startingEquipment[list].length) ? { starting_equipment: { attacks: [...cls.startingEquipment.attacks], actions: [...cls.startingEquipment.actions], items: [...cls.startingEquipment.items] } } : {}),
    ...(cls.spellList ? { spell_list: [...cls.spellList] } : {}),
  }));
  if (draft.pointEnabled) {
    const point = draft.point;
    rules.point_buy = { attributes: [...point.attributes], min: draftInteger(point.min, "Minimum score"), max: draftInteger(point.max, "Maximum score"), budget: draftInteger(point.budget, "Point budget"), bonus_budget: draftInteger(point.bonus_budget, "Bonus budget"), bonus_max: draftInteger(point.bonus_max, "Per-score bonus cap"), costs: Object.fromEntries(scoreRange(point).map((score) => [String(score), draftInteger(point.costs[String(score)] ?? "", `Cost for score ${score}`)])) };
  }
  return validateCreationRules(rules, attributes, compendium);
}
