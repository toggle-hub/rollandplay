import type { MapStructure } from "../api/types";
import type { Point } from "./geometryTransforms";
import { placed, snap } from "./structures";

export type SnapKind = "point" | "grid" | "free";
export type Snapped = { point: Point; kind: SnapKind };
export type SnapOptions = {
  /** Grid square size in meters. */
  grid: number;
  /** Corners of other structures to stick to when the pointer is within `radius` of one. */
  points: Point[];
  /** Distance in meters within which a structure corner wins over the grid. */
  radius: number;
  /** Free placement: keep the point where it is (rounded to a centimeter). */
  free?: boolean;
};

/** Every corner of the structures, skipping the ids in `exclude`. */
export function structureVertices(structures: MapStructure[], exclude?: ReadonlySet<string>): Point[] {
  return structures.flatMap((structure) => exclude?.has(structure.id) ? [] : structure.geometry);
}

/** Snaps a point to the nearest structure corner within the radius, otherwise to the nearest grid corner. */
export function snapPoint(point: Point, { grid, points, radius, free }: SnapOptions): Snapped {
  if (free) return { point: { x: placed(point.x), y: placed(point.y) }, kind: "free" };
  let best: Point | null = null;
  let bestDistance = radius;
  for (const candidate of points) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best) return { point: { x: best.x, y: best.y }, kind: "point" };
  const size = Math.max(grid, 0.01);
  return { point: { x: snap(point.x, size), y: snap(point.y, size) }, kind: "grid" };
}

/** The corner of `geometry` closest to `point`: the one a drag that started at `point` lines up. */
export function nearestVertex(geometry: Point[], point: Point): Point {
  let best = geometry[0] ?? point;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const vertex of geometry) {
    const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (distance < bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The offset to move a selection by so that its grabbed corner (`anchor`) lands on a grid corner or a
 * nearby structure corner. `lock` keeps one axis still (Shift-drag).
 */
export function snapMoveDelta(anchor: Point, delta: Point, options: SnapOptions, lock?: "x" | "y"): Point {
  const target = snapPoint({ x: anchor.x + delta.x, y: anchor.y + delta.y }, options).point;
  return {
    x: lock === "x" ? 0 : placed(target.x - anchor.x),
    y: lock === "y" ? 0 : placed(target.y - anchor.y),
  };
}

/**
 * The uniform scale factor about `anchor` that brings the dragged `handle` as close as possible to
 * `target` (already snapped): the target projected onto the anchor–handle line. Never below 0.08.
 */
export function scaleFactorTowards(anchor: Point, handle: Point, target: Point): number {
  const vx = handle.x - anchor.x;
  const vy = handle.y - anchor.y;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) return 1;
  const factor = ((target.x - anchor.x) * vx + (target.y - anchor.y) * vy) / lengthSquared;
  return Math.max(0.08, factor);
}
