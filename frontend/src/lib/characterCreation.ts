import type { CharacterCreation, CreationRules, RuleBook } from "../api/types";

export type CreationErrorGroup = "form" | "name" | "book" | "class" | `choice:${string}` | "points" | "values";

/** A character-creation error shown at the top of the form group it belongs to. */
export class CreationError extends Error {
  constructor(message: string, readonly group: CreationErrorGroup) { super(message); }
}

export function creationLabel(name: string) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function initialCreation(rules: CreationRules): CharacterCreation {
  const points = rules.point_buy;
  return points ? {
    scores: Object.fromEntries(points.attributes.map((attribute) => [attribute, points.min])),
    bonuses: Object.fromEntries(points.attributes.map((attribute) => [attribute, 0])),
  } : {};
}

function booleanGroup(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function managedCharacterData(book: RuleBook, creation: CharacterCreation): Record<string, unknown> {
  const rules = book.creation_rules;
  const selected = rules.classes?.find((item) => item.id === creation.class_id);
  const classValues = selected ? { ...selected.defaults, class: selected.name } : {};
  const choices = (selected?.choices ?? []).map((choice) => {
    const chosen = creation.choices?.[choice.attribute] ?? [];
    const baseline = booleanGroup(selected?.defaults[choice.attribute] ?? book.attributes[choice.attribute]);
    return [choice.attribute, Object.fromEntries([
      ...Object.entries(baseline),
      ...choice.options.map((option) => [option, chosen.includes(option)]),
    ])];
  });
  const scores = (rules.point_buy?.attributes ?? []).map((attribute) => [attribute,
    (creation.scores?.[attribute] ?? rules.point_buy!.min) + (creation.bonuses?.[attribute] ?? 0),
  ]);
  return Object.fromEntries([...Object.entries(classValues), ...choices, ...scores]);
}

export function freeCharacterData(book: RuleBook, creation: CharacterCreation, data: Record<string, unknown>) {
  const managed = managedCharacterData(book, creation);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !Object.hasOwn(managed, key) && !(book.creation_rules.classes?.length && key === "class")));
}

export function completeCharacterData(book: RuleBook, creation: CharacterCreation, data: Record<string, unknown>) {
  return { ...book.attributes, ...data, ...managedCharacterData(book, creation) };
}

function equalValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.entries(left), b = Object.entries(right);
  return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key) && equalValue(value, (right as Record<string, unknown>)[key]));
}

export function validateManagedData(book: RuleBook, creation: CharacterCreation, data: Record<string, unknown>) {
  for (const [key, expected] of Object.entries(managedCharacterData(book, creation))) {
    if (Object.hasOwn(data, key) && !equalValue(data[key], expected)) {
      throw new CreationError(`${creationLabel(key)} is set by your class or point allocation. Change it using the controls above, not the character JSON.`, "values");
    }
  }
}

export function validateCharacterCreation(book: RuleBook, creation: CharacterCreation) {
  const rules = book.creation_rules;
  const selected = rules.classes?.find((item) => item.id === creation.class_id);
  if (rules.classes?.length && !selected) throw new CreationError("Choose a class for your character.", "class");
  for (const choice of selected?.choices ?? []) {
    const chosen = creation.choices?.[choice.attribute] ?? [];
    if (chosen.length !== choice.count || new Set(chosen).size !== chosen.length || chosen.some((option) => !choice.options.includes(option))) {
      throw new CreationError(`${choice.label}: choose exactly ${choice.count} different options from the list.`, `choice:${choice.attribute}`);
    }
  }
  const points = rules.point_buy;
  if (!points) return;
  let spent = 0, bonuses = 0;
  for (const attribute of points.attributes) {
    const score = creation.scores?.[attribute];
    const bonus = creation.bonuses?.[attribute] ?? 0;
    if (score === undefined || !Number.isInteger(score) || score < points.min || score > points.max) throw new CreationError(`${creationLabel(attribute)} must have a base score from ${points.min} to ${points.max}.`, "points");
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > points.bonus_max) throw new CreationError(`${creationLabel(attribute)} bonus must be from 0 to ${points.bonus_max}.`, "points");
    spent += points.costs[String(score)];
    bonuses += bonus;
  }
  if (!Number.isFinite(spent) || spent > points.budget) throw new CreationError(`Your base scores exceed the ${points.budget}-point budget.`, "points");
  if (bonuses > points.bonus_budget) throw new CreationError(`Your bonuses exceed the ${points.bonus_budget}-point bonus budget.`, "points");
}
