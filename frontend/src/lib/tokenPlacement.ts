import type { Point } from "./geometryTransforms";
import { legBlocked } from "./movement";
import type { Segment } from "./segments";
import { clampTokenCenter } from "./tokenGrid";

export type Footprint = { center: Point; sizeM: number };

/** Rings searched around a taken spot before giving up and placing the token where it was dropped. */
const searchRings = 24;

/**
 * Where a new token dropped at `point` stands: on the map and, when another token already covers that
 * spot, the closest spot where the new token overlaps none and that it reaches from the drop point without
 * crossing a barrier. Among spots as close, the one on the side the drop leaned towards, away from the
 * covered token's centre, wins. Tokens only touching each other do not overlap. Stays at the drop point
 * when nothing nearby is free.
 */
export function placementSpot(point: Point, sizeM: number, others: readonly Footprint[], mapWidthM: number, mapHeightM: number, barriers: Segment[]): Point {
  const start = clampTokenCenter(point, sizeM, mapWidthM, mapHeightM);
  // Spots are rounded to the hundredth of a meter the server stores, so allow that much contact.
  const overlaps = (spot: Point, other: Footprint) =>
    Math.hypot(other.center.x - spot.x, other.center.y - spot.y) < (other.sizeM + sizeM) / 2 - 0.01;
  const covered = others.find((other) => overlaps(start, other));
  if (!covered) return start;
  const lean = Math.atan2(start.y - covered.center.y, start.x - covered.center.x);
  const step = Math.max(sizeM / 4, 0.25);
  for (let ring = 1; ring <= searchRings; ring++) {
    const radius = ring * step;
    const count = Math.max(8, Math.ceil((2 * Math.PI * radius) / step));
    // Directions alternate either side of the lean: 0, +1, −1, +2, −2, …
    for (let index = 0; index < count; index++) {
      const turn = index % 2 === 0 ? index / 2 : -(index + 1) / 2;
      const angle = lean + (turn / count) * Math.PI * 2;
      const spot = clampTokenCenter({ x: start.x + Math.cos(angle) * radius, y: start.y + Math.sin(angle) * radius }, sizeM, mapWidthM, mapHeightM);
      if (others.some((other) => overlaps(spot, other)) || legBlocked(start, spot, barriers)) continue;
      return spot;
    }
  }
  return start;
}
