import type { Monster } from "../api/types";
import { fieldFromValue, objectFromFields, type Field } from "./attributeFields";

export type MonsterDraft = { key: string; id: string; name: string; description: string; size: string; stats: Field[] };

/** Same grammar as the server's monster ids (Go `monsterIDRE`). */
const monsterIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Book attributes a new monster starts with, when the book defines them. */
const starterKeys = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma", "armor_class", "hit_points", "max_hit_points", "speed_m", "proficiency_bonus"];

export function monsterDrafts(monsters: Monster[] = []): MonsterDraft[] {
  return monsters.map((monster) => ({
    key: crypto.randomUUID(), id: monster.id, name: monster.name, description: monster.description ?? "", size: String(monster.size_m),
    stats: Object.entries(monster.stats ?? {}).map(([key, value]) => fieldFromValue(key, value)),
  }));
}

export function newMonsterDraft(bookAttributes: Record<string, unknown>): MonsterDraft {
  const stats = Object.fromEntries(starterKeys.filter((key) => key in bookAttributes).map((key) => [key, bookAttributes[key]]));
  return { key: crypto.randomUUID(), id: "", name: "", description: "", size: "1.5", stats: Object.entries({ ...stats, attacks: [] }).map(([key, value]) => fieldFromValue(key, value)) };
}

/** "Giant rat" -> "giant_rat"; unique against ids already taken. */
export function monsterId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56) || "monster";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

export function monstersFromDrafts(drafts: MonsterDraft[]): Monster[] {
  const taken = new Set(drafts.map((draft) => draft.id).filter(Boolean));
  const seen = new Set<string>();
  return drafts.map((draft, index) => {
    const name = draft.name.trim();
    if (!name) throw new Error(`Monster ${index + 1}: give it a name.`);
    const id = draft.id || monsterId(name, taken);
    taken.add(id);
    if (!monsterIdPattern.test(id) || seen.has(id)) throw new Error(`Monster “${name}”: its id “${id}” must be unique and use lowercase letters, digits, - or _.`);
    seen.add(id);
    const size = Number(draft.size);
    if (!Number.isFinite(size) || size <= 0 || size > 30) throw new Error(`Monster “${name}”: size must be between 0 and 30 meters.`);
    return { id, name, description: draft.description.trim(), size_m: size, stats: objectFromFields(draft.stats, `Monster “${name}” stats`) };
  });
}
