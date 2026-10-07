import type { Combat } from "../api/types";

/** The token whose turn it is; undefined with no fight, an empty order, or (for players) a hidden token acting. */
export function currentTurnTokenId(combat: Combat | null | undefined): string | undefined {
  if (!combat?.current_combatant_id) return undefined;
  return combat.combatants.find((combatant) => combatant.id === combat.current_combatant_id)?.token_id;
}

/** What the token has left this turn while it is taking its turn, else null. */
export function turnLeft(combat: Combat | null | undefined, tokenId: string): { actions: number; movedM: number } | null {
  if (!combat || currentTurnTokenId(combat) !== tokenId) return null;
  return { actions: Math.max(0, combat.actions_allowed - combat.actions_used), movedM: combat.moved_m };
}

/** Tokens a player may not move or act with now: every token in the fight except the current one. Empty for game masters. */
export function offTurnTokenIds(combat: Combat | null | undefined, isDM: boolean): Set<string> {
  if (isDM || !combat) return new Set();
  const current = currentTurnTokenId(combat);
  return new Set(combat.combatants.map((combatant) => combatant.token_id).filter((tokenId) => tokenId !== current));
}

/** Why the viewer cannot attack, cast or use an item with the token now, else undefined. */
export function turnBlockReason(combat: Combat | null | undefined, isDM: boolean, tokenId: string): string | undefined {
  if (isDM) return undefined;
  if (offTurnTokenIds(combat, isDM).has(tokenId)) return "Not this character's turn";
  if (turnLeft(combat, tokenId)?.actions === 0) return "Action used this turn";
  return undefined;
}
