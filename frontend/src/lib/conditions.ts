import type { TokenStatus } from "../api/types";

/** Same keys and order as the server's `game.Conditions`: the 5e conditions plus concentrating. */
export const conditionKeys = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "concentrating",
];

/** Same limits as the server. */
export const maxConditions = 12;
export const maxConditionLength = 32;

/** "prone" reads "Prone"; the game master's own words are shown as typed. */
export function conditionLabel(condition: string): string {
  return conditionKeys.includes(condition) ? condition.charAt(0).toUpperCase() + condition.slice(1) : condition;
}

/** Adds a condition unless the token already has it (case-insensitive); known names use their key. */
export function withCondition(conditions: readonly string[], raw: string): string[] {
  const name = raw.trim().replace(/\s+/g, " ");
  const folded = name.toLowerCase();
  if (!name || conditions.some((condition) => condition.toLowerCase() === folded)) return [...conditions];
  return [...conditions, conditionKeys.includes(folded) ? folded : name];
}

export const statusLabels: Record<TokenStatus, string> = { down: "Down", stable: "Stable", dead: "Dead" };
