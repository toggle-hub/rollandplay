import type { Monster } from "../api/types";
import { humanizeKey } from "./checks";

/** "Giant rat" -> "giant_rat": lowercase letters, digits and _, made unique against `taken` ("giant_rat_2"). */
export function uniqueSlug(name: string, taken: Set<string>, fallback: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56) || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

/** A group of yes/no values, such as skill proficiencies: what a class choice group picks from. */
export function isYesNoGroup(value: unknown): value is Record<string, boolean> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const items = Object.values(value);
  return items.length > 0 && items.every((item) => typeof item === "boolean");
}

/** A rule book value as plain text: "10", "Yes", "Stealth, Perception", "Walk 9, Fly 0", "3 items". */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "—";
  if (isYesNoGroup(value)) return entries.filter(([, item]) => item).map(([key]) => humanizeKey(key)).join(", ") || "None";
  return entries.map(([key, item]) => `${humanizeKey(key)} ${formatValue(item)}`).join(", ");
}

/** "HP 7 · AC 15 · Scimitar, Shortbow": what a game master needs to tell monsters apart. */
export function monsterSummary(monster: Monster): string {
  const { hit_points: hp, armor_class: ac, attacks, actions, items } = monster.stats;
  const moves = [attacks, actions, items].flatMap((list) => Array.isArray(list) ? list.map((entry: { name?: unknown }) => String(entry.name ?? "")) : []).filter(Boolean);
  return [typeof hp === "number" && `HP ${hp}`, typeof ac === "number" && `AC ${ac}`, moves.join(", ")].filter(Boolean).join(" · ");
}
