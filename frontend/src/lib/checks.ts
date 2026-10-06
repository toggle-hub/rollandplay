import type { CheckKind, RoomCheck } from "../api/types";
import { dndAbilities } from "./attacks";

/** Built-in D&D book skills; the server maps each to its ability (Go `DnDSkillAbility`). */
export const dndSkills = [
  "acrobatics", "animal_handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation",
  "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight_of_hand", "stealth", "survival",
];

export const checkKinds: { value: CheckKind; label: string }[] = [
  { value: "skill", label: "Skill check" },
  { value: "save", label: "Saving throw" },
  { value: "ability", label: "Ability check" },
  { value: "attribute", label: "Other attribute" },
];

/** Same grammar as the server's attribute keys: a top-level sheet key such as speed_m. */
export const attributeKeyPattern = "[a-z][a-z0-9_]{0,63}";

export function checkKeyOptions(kind: CheckKind): string[] {
  if (kind === "skill") return dndSkills;
  if (kind === "ability" || kind === "save") return dndAbilities;
  return [];
}

export function defaultCheckKey(kind: CheckKind): string {
  if (kind === "skill") return "perception";
  if (kind === "ability" || kind === "save") return "dexterity";
  return "";
}

export function humanizeKey(key: string): string {
  const text = key.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An open check that still waits for `userId` to roll. */
export function isPendingFor(check: RoomCheck, userId: string | undefined): boolean {
  return !check.closed_at && !!userId && check.targets.some((target) => target.user_id === userId && !target.roll);
}
