import type { MapStructure, ResolvedTokenAttack } from "../api/types";
import type { Point } from "./geometryTransforms";

export type AttackTargetStatus = "valid" | "out_of_range" | "blocked";

/** Same grammar as the server's dice expressions (Go `diceExprRE`). */
export const diceExpressionPattern = /^[+-]?([0-9]*d[0-9]+|[0-9]+)([+-]([0-9]*d[0-9]+|[0-9]+))*$/;

export const dndAbilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

const eps = 1e-9;

/** Port of the server's attack line-of-fire rule: visible structures that block attacks and do not let them pass. */
export function attackLineBlocked(from: Point, to: Point, structures: MapStructure[]): boolean {
  const line = { a: from, b: to };
  return structures.some((structure) => {
    if (structure.is_hidden || !structure.blocks_attacks || structure.pass_rules?.attacks) return false;
    const points = structure.geometry;
    for (let index = 0; index < points.length - 1; index++) {
      if (segmentIntersects(line, { a: points[index], b: points[index + 1] })) return true;
    }
    return points.length > 2 && segmentIntersects(line, { a: points[points.length - 1], b: points[0] });
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
  return `${toHit} to hit · ${a.damage}${formatModifier(a.damage_modifier)} · ${a.range_m} m`;
}

type Segment = { a: Point; b: Point };

function segmentIntersects(s: Segment, t: Segment) {
  const d1 = orient(s.a, s.b, t.a);
  const d2 = orient(s.a, s.b, t.b);
  const d3 = orient(t.a, t.b, s.a);
  const d4 = orient(t.a, t.b, s.b);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  return (Math.abs(d1) <= eps && onSegment(s.a, t.a, s.b))
    || (Math.abs(d2) <= eps && onSegment(s.a, t.b, s.b))
    || (Math.abs(d3) <= eps && onSegment(t.a, s.a, t.b))
    || (Math.abs(d4) <= eps && onSegment(t.a, s.b, t.b));
}

function orient(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, p: Point, b: Point) {
  return p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps
    && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
}
