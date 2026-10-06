import type { ResolvedTokenAction, ResolvedTokenAttack, ResolvedTokenItem, TokenAction, TokenAttack, TokenItem } from "../api/types";
import { dndAbilities } from "./attacks";
import { creationLabel } from "./characterCreation";

/** Same mapping as the server's `game.DnDSkillAbility`. */
export const skillAbility: Record<string, string> = {
  acrobatics: "dexterity", animal_handling: "wisdom", arcana: "intelligence", athletics: "strength",
  deception: "charisma", history: "intelligence", insight: "wisdom", intimidation: "charisma",
  investigation: "intelligence", medicine: "wisdom", nature: "intelligence", perception: "wisdom",
  performance: "charisma", persuasion: "charisma", religion: "intelligence", sleight_of_hand: "dexterity",
  stealth: "dexterity", survival: "wisdom",
};

export const abilityShort: Record<string, string> = {
  strength: "STR", dexterity: "DEX", constitution: "CON", intelligence: "INT", wisdom: "WIS", charisma: "CHA",
};

/** The D&D ability modifier, as the server computes it: floor((score − 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** A bonus with its sign, "+0" for zero. */
export function signed(n: number): string {
  return n < 0 ? `${n}` : `+${n}`;
}

/** The 5e proficiency bonus for a character level: +2 at levels 1–4, +3 at 5–8, … +6 at 17–20. */
export function proficiencyForLevel(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Values a D&D-style character derives from its level, class hit die and ability scores. */
export const derivedKeys = ["proficiency_bonus", "max_hit_points", "hit_points", "armor_class", "initiative"] as const;
export type DerivedKey = typeof derivedKeys[number];
export type Derived = { value: number; hint: string };

/**
 * Starting values derived from `values` (the character's complete data). Only keys the character
 * already has as numbers are derived, and only when their inputs exist. Keys in `edited` are the
 * player's own; current hit points follow the maximum, whether calculated or edited.
 */
export function derivedStartingValues(values: Record<string, unknown>, edited: ReadonlySet<string> = new Set()): Partial<Record<DerivedKey, Derived>> {
  const out: Partial<Record<DerivedKey, Derived>> = {};
  const has = (key: string) => numberValue(values[key]) !== undefined;
  const rawLevel = numberValue(values.level);
  // Without a level attribute the character is level 1; an unusable level derives nothing level-based.
  const level = !Object.hasOwn(values, "level") ? 1 : rawLevel !== undefined && Number.isInteger(rawLevel) && rawLevel >= 1 && rawLevel <= 20 ? rawLevel : undefined;
  if (has("proficiency_bonus") && level !== undefined) out.proficiency_bonus = { value: proficiencyForLevel(level), hint: `Level ${level}` };
  const dexterity = numberValue(values.dexterity);
  if (dexterity !== undefined) {
    const mod = abilityModifier(dexterity);
    if (has("armor_class")) out.armor_class = { value: 10 + mod, hint: `10 + Dexterity ${signed(mod)}, without armor` };
    if (has("initiative")) out.initiative = { value: mod, hint: `Dexterity ${signed(mod)}` };
  }
  const constitution = numberValue(values.constitution);
  const hitDie = numberValue(values.hit_die);
  if (has("max_hit_points") && level !== undefined && constitution !== undefined && hitDie !== undefined && Number.isInteger(hitDie) && hitDie > 0) {
    const mod = abilityModifier(constitution);
    const perLevel = Math.floor(hitDie / 2) + 1;
    const value = Math.max(1, hitDie + mod) + (level - 1) * Math.max(1, perLevel + mod);
    out.max_hit_points = {
      value,
      hint: level === 1 ? `Hit die ${hitDie} + Constitution ${signed(mod)}` : `Hit die ${hitDie} + Constitution ${signed(mod)}, then ${perLevel} + Constitution per level`,
    };
  }
  if (has("hit_points")) {
    const max = edited.has("max_hit_points") ? numberValue(values.max_hit_points) : out.max_hit_points?.value;
    if (max !== undefined) out.hit_points = { value: max, hint: "Starts at full hit points" };
  }
  return out;
}

function proficiencyBonus(stats: Record<string, unknown>): number {
  return Math.round(numberValue(stats.proficiency_bonus) ?? 0);
}

function modifierOf(stats: Record<string, unknown>, ability: string): number {
  const score = numberValue(stats[ability]);
  return score === undefined ? 0 : abilityModifier(score);
}

/** Whether a yes/no group (e.g. `saving_throw_proficiencies`) marks `key`. */
export function proficient(stats: Record<string, unknown>, group: string, key: string): boolean {
  const flags = stats[group];
  return !!flags && typeof flags === "object" && (flags as Record<string, unknown>)[key] === true;
}

/** A saving throw or skill bonus as the server rolls it: ability modifier plus proficiency when proficient. */
export function checkBonus(stats: Record<string, unknown>, ability: string, group: string, key: string): number {
  return modifierOf(stats, ability) + (proficient(stats, group, key) ? proficiencyBonus(stats) : 0);
}

/** Port of the server's `ResolveAction`: folds the character's modifier and proficiency into the entry. */
export function resolveAction(entry: TokenAction | TokenItem, stats: Record<string, unknown>): ResolvedTokenAction | ResolvedTokenItem {
  const mod = modifierOf(stats, entry.ability);
  const prof = entry.proficient ? proficiencyBonus(stats) : 0;
  return {
    ...entry,
    dice_modifier: entry.dice_bonus + (entry.ability_to_dice ? mod : 0),
    to_hit: entry.kind === "attack" ? mod + prof + entry.bonus : 0,
    save_dc: entry.kind === "save" ? 8 + mod + prof + entry.bonus : 0,
  } as ResolvedTokenAction | ResolvedTokenItem;
}

/** Port of the server's `ResolveAttack`: the ability modifier adds to the hit and the damage. */
export function resolveAttack(attack: TokenAttack, stats: Record<string, unknown>): ResolvedTokenAttack {
  const mod = modifierOf(stats, attack.ability);
  const prof = attack.proficient ? proficiencyBonus(stats) : 0;
  return { ...attack, to_hit: mod + prof + attack.attack_bonus, damage_modifier: mod + attack.damage_bonus };
}

/** Short facts for a character card: level, hit points and armor class when the sheet has them. */
export function sheetHighlights(data: Record<string, unknown>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const level = numberValue(data.level);
  if (level !== undefined) out.push({ label: "Level", value: String(level) });
  const hp = numberValue(data.hit_points), max = numberValue(data.max_hit_points);
  if (hp !== undefined) out.push({ label: "HP", value: max !== undefined ? `${hp} / ${max}` : String(hp) });
  const ac = numberValue(data.armor_class);
  if (ac !== undefined) out.push({ label: "AC", value: String(ac) });
  return out;
}

/** The D&D ability scores a sheet has, in the usual order. */
export function sheetAbilities(data: Record<string, unknown>): { key: string; score: number; modifier: number }[] {
  return dndAbilities.flatMap((key) => {
    const score = numberValue(data[key]);
    return score === undefined ? [] : [{ key, score, modifier: abilityModifier(score) }];
  });
}

/** A plain-language rendering of a sheet value: yes/no groups list what is set, hit dice read "d10". */
export function describeValue(key: string, value: unknown): string {
  if (key === "hit_die" && typeof value === "number") return `d${value}`;
  if (Array.isArray(value)) return value.map((item) => describeValue("", item)).join(", ") || "None";
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.every(([, item]) => typeof item === "boolean")) return entries.filter(([, enabled]) => enabled).map(([name]) => creationLabel(name)).join(", ") || "None";
    return entries.map(([name, item]) => `${creationLabel(name)}: ${describeValue(name, item)}`).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === "") return "Not set";
  return String(value);
}
