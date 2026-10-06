import type { ActionLists, Monster } from "../api/types";
import { emptyActionLists, sheetActionLists } from "./actions";
import { fieldFromValue, objectFromFields, type Field } from "./attributeFields";
import { uniqueSlug } from "./ruleBooks";

/** `stats` holds the plain stat fields; attacks, spells & abilities and items are edited as `lists`. */
export type MonsterDraft = { key: string; id: string; name: string; description: string; size: string; stats: Field[]; lists: ActionLists };

/** Same grammar as the server's monster ids (Go `monsterIDRE`). */
const monsterIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Book attributes a new monster starts with, when the book defines them. */
const starterKeys = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma", "armor_class", "hit_points", "max_hit_points", "speed_m", "proficiency_bonus"];
const listKeys = ["attacks", "actions", "items"] as const;
const listKeyNames: readonly string[] = listKeys;

export function monsterDrafts(monsters: Monster[] = []): MonsterDraft[] {
  return monsters.map((monster) => ({
    key: crypto.randomUUID(), id: monster.id, name: monster.name, description: monster.description ?? "", size: String(monster.size_m),
    stats: Object.entries(monster.stats ?? {}).filter(([key]) => !listKeyNames.includes(key)).map(([key, value]) => fieldFromValue(key, value)),
    lists: sheetActionLists(monster.stats ?? {}),
  }));
}

export function newMonsterDraft(bookAttributes: Record<string, unknown>): MonsterDraft {
  const stats = starterKeys.filter((key) => key in bookAttributes).map((key) => fieldFromValue(key, bookAttributes[key]));
  return { key: crypto.randomUUID(), id: "", name: "", description: "", size: "1.5", stats, lists: emptyActionLists() };
}

/** The plain stats of a draft, for previews; an unfinished field leaves them empty. */
export function draftStats(draft: MonsterDraft): Record<string, unknown> {
  try { return objectFromFields(draft.stats); } catch { return {}; }
}

export function monstersFromDrafts(drafts: MonsterDraft[]): Monster[] {
  const taken = new Set(drafts.map((draft) => draft.id).filter(Boolean));
  const seen = new Set<string>();
  return drafts.map((draft, index) => {
    const name = draft.name.trim();
    if (!name) throw new Error(`Monster ${index + 1}: give it a name.`);
    const id = draft.id || uniqueSlug(name, taken, "monster");
    taken.add(id);
    if (!monsterIdPattern.test(id) || seen.has(id)) throw new Error(`Monster “${name}”: its id “${id}” must be unique and use lowercase letters, digits, - or _.`);
    seen.add(id);
    const size = Number(draft.size);
    if (!Number.isFinite(size) || size <= 0 || size > 30) throw new Error(`Monster “${name}”: size must be between 0 and 30 meters.`);
    const stats = objectFromFields(draft.stats, `Monster “${name}” stats`);
    const listKey = Object.keys(stats).find((key) => listKeyNames.includes(key));
    if (listKey) throw new Error(`Monster “${name}”: remove the “${listKey}” stat and use Attacks & abilities instead.`);
    for (const list of listKeys) if (draft.lists[list].length) stats[list] = draft.lists[list];
    return { id, name, description: draft.description.trim(), size_m: size, stats };
  });
}
