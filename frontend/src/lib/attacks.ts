import type { MapStructure, ResolvedTokenAttack } from "../api/types";
import type { Point } from "./geometryTransforms";
import { segmentsIntersect, structureSegments } from "./segments";

export type AttackTargetStatus = "valid" | "out_of_range" | "blocked";

/** Same grammar as the server's dice expressions (Go `diceExprRE`): NdM, NdMkhK/NdMklK (keep highest/lowest K) and whole numbers joined by + and -. */
export const diceExpressionPattern = /^[+-]?([0-9]*d[0-9]+(k[hl][0-9]+)?|[0-9]+)([+-]([0-9]*d[0-9]+(k[hl][0-9]+)?|[0-9]+))*$/;

export const dndAbilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

const eps = 1e-9;

/** Port of the server's attack line-of-fire rule: visible structures that block attacks and do not let them pass. */
export function attackLineBlocked(from: Point, to: Point, structures: MapStructure[]): boolean {
  return structures.some((structure) => {
    if (structure.is_hidden || !structure.blocks_attacks || structure.pass_rules?.attacks) return false;
    return structureSegments(structure).some((segment) => segmentsIntersect([from, to], segment));
  });
}

/** Range is checked before line of fire, matching the server's order. */
export function attackTargetStatus(source: Point, target: Point, rangeM: number, structures: MapStructure[]): AttackTargetStatus {
  if (Math.hypot(target.x - source.x, target.y - source.y) > rangeM + eps) return "out_of_range";
  return attackLineBlocked(source, target, structures) ? "blocked" : "valid";
}

export function formatModifier(n: number): string {
  if (n === 0) return "";
  return n > 0 ? `+${n}` : `${n}`;
}

export function attackSummary(a: ResolvedTokenAttack): string {
  const toHit = a.to_hit === 0 ? "+0" : formatModifier(a.to_hit);
  return `${toHit} to hit · ${a.damage}${formatModifier(a.damage_modifier)}${a.damage_type ? ` ${a.damage_type}` : ""} · ${a.range_m} m`;
}
