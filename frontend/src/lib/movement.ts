import type { MapStructure } from "../api/types";
import type { Point } from "./geometryTransforms";
import { segmentsIntersect, structureSegments, type Segment } from "./segments";
import { placed, structurePassable } from "./structures";

/** Legs one step may take, enough to slide into a corner or around a wall's end. */
const maxLegs = 6;
const eps = 1e-9;

/** The segments the server's movement rule checks: visible structures that block movement and do not let it pass. */
export function movementBarriers(structures: MapStructure[]): Segment[] {
  return structures
    .filter((structure) => !structurePassable(structure) && structure.blocks_movement && !structure.pass_rules?.movement)
    .flatMap(structureSegments);
}

export function legBlocked(from: Point, to: Point, barriers: Segment[]) {
  return barriers.some((barrier) => segmentsIntersect([from, to], barrier));
}

/**
 * Walks a token center from `from` toward `to` the way a body moves. Walking into a barrier leaves it
 * resting `clearanceM` off the barrier, pushed back out if it had crept closer, and the rest of the motion
 * slides it along the barrier; `keep` holds slide targets on the map. Returns the corners it passed,
 * ending where it stopped, each rounded to the hundredth of a meter the server stores; every leg from
 * `from` is clear. Empty when the token cannot move.
 */
export function walkToken(from: Point, to: Point, clearanceM: number, barriers: Segment[], keep: (point: Point) => Point): Point[] {
  const route: Point[] = [];
  let at = from;
  let target = to;
  for (let leg = 0; leg < maxLegs; leg++) {
    const hit = firstBarrier(at, target, barriers);
    const dx = target.x - at.x, dy = target.y - at.y;
    let resting = target;
    if (hit?.along) {
      const share = Math.max(0, hit.t - clearanceM / Math.hypot(dx, dy));
      resting = { x: at.x + dx * share, y: at.y + dy * share };
    } else if (hit && Math.abs(hit.start) >= clearanceM) {
      const share = (hit.start - Math.sign(hit.start) * clearanceM) / (hit.start - hit.end);
      resting = { x: at.x + dx * share, y: at.y + dy * share };
    } else if (hit) {
      // Closer than the clearance already: step straight back out from the barrier.
      const [a, b] = hit.barrier;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const out = Math.sign(hit.start) * (clearanceM - Math.abs(hit.start)) / length;
      resting = keep({ x: at.x - (b.y - a.y) * out, y: at.y + (b.x - a.x) * out });
    }
    const stop = { x: placed(resting.x), y: placed(resting.y) };
    if (stop.x !== at.x || stop.y !== at.y) {
      if (legBlocked(at, stop, barriers)) break;
      route.push(stop);
      at = stop;
    }
    // Running along a barrier's own line leaves nothing to slide along.
    if (hit?.along) break;
    if (!hit) {
      // A slide that cleared the barrier heads on for the pointer.
      if (target === to) break;
      target = to;
      continue;
    }
    const [a, b] = hit.barrier;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
    const rest = (to.x - at.x) * ux + (to.y - at.y) * uy;
    if (Math.abs(rest) < 0.005) break;
    target = keep({ x: at.x + ux * rest, y: at.y + uy * rest });
  }
  return route;
}

/**
 * Adds a point the token walked to to its route. The previous corner is dropped when the straight leg
 * past it is clear, so the route keeps only the turns the server has to check.
 */
export function extendPath(path: Point[], point: Point, barriers: Segment[]) {
  if (path.length > 1 && !legBlocked(path[path.length - 2], point, barriers)) path[path.length - 1] = point;
  else path.push(point);
}

/**
 * The barrier the leg meets first: `t` is how far along the leg it meets it, `start` and `end` the
 * signed distances of the leg's ends from the barrier's line, and `along` that the leg runs on that line.
 */
function firstBarrier(from: Point, to: Point, barriers: Segment[]) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  let first: { barrier: Segment; t: number; start: number; end: number; along: boolean } | undefined;
  for (const barrier of barriers) {
    if (!segmentsIntersect([from, to], barrier)) continue;
    const [a, b] = barrier;
    const wx = b.x - a.x, wy = b.y - a.y;
    const length = Math.hypot(wx, wy);
    const start = length > eps ? (wx * (from.y - a.y) - wy * (from.x - a.x)) / length : 0;
    const end = length > eps ? (wx * (to.y - a.y) - wy * (to.x - a.x)) / length : 0;
    const along = Math.abs(start - end) <= eps;
    let t: number;
    if (along) {
      // Where the leg first reaches the barrier's nearer end, or zero if it starts on it.
      const reach = Math.min((a.x - from.x) * dx + (a.y - from.y) * dy, (b.x - from.x) * dx + (b.y - from.y) * dy);
      t = lengthSq > eps ? Math.min(Math.max(reach / lengthSq, 0), 1) : 0;
    } else {
      t = Math.min(Math.max(start / (start - end), 0), 1);
    }
    if (!first || t < first.t) first = { barrier, t, start, end, along };
  }
  return first;
}
