/** Advantage rolls 2d20 and keeps the higher, disadvantage keeps the lower (server `game.RollOptions`). */
export type RollMode = "normal" | "advantage" | "disadvantage";
export type RollOptions = { mode: RollMode; bonus: number };
/** The optional `mode` and `bonus` fields a roll request carries; empty for a normal roll. */
export type RollOptionsBody = { mode?: Exclude<RollMode, "normal">; bonus?: number };

/** Same limit as the server's `game.MaxRollBonus`. */
export const maxRollBonus = 20;

export const normalRoll: RollOptions = { mode: "normal", bonus: 0 };

export function rollOptionsBody(options: RollOptions): RollOptionsBody {
  const body: RollOptionsBody = {};
  if (options.mode !== "normal") body.mode = options.mode;
  if (options.bonus !== 0) body.bonus = options.bonus;
  return body;
}

/** A whole bonus within the server's limit; anything else counts as no bonus. */
export function clampBonus(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-maxRollBonus, Math.min(maxRollBonus, Math.trunc(value)));
}

/** Plain description of what the d20 roll does, e.g. "Rolls 2d20 and keeps the higher, +2". */
export function rollOptionsHint(options: RollOptions): string {
  const dice = options.mode === "advantage" ? "Rolls 2d20 and keeps the higher" : options.mode === "disadvantage" ? "Rolls 2d20 and keeps the lower" : "Rolls 1d20";
  return options.bonus ? `${dice}, ${options.bonus > 0 ? "+" : ""}${options.bonus} bonus` : dice;
}
