import type { MapStructure } from "../api/types";
import type { Point } from "./geometryTransforms";

const steps = 180;
const fullTurn = 2 * Math.PI;
const normalize = (angle: number) => ((angle % fullTurn) + fullTurn) % fullTurn;

/**
 * Port of the server's castVision: a full circle of radius rangeM around origin, cut short
 * wherever a visible, vision-blocking structure is in the way. Players only know the structures
 * they can already see, so a cast at a new position is a preview until the server recasts it.
 */
export function castVision(origin: Point, rangeM: number, structures: MapStructure[]): Point[] {
  const blockers = structures.filter((structure) => !structure.is_hidden && structure.blocks_vision);
  const angles: number[] = [];
  for (let index = 0; index < steps; index++) angles.push(index * fullTurn / steps);
  blockers.forEach((structure) => structure.geometry.forEach((point) => {
    const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
    angles.push(normalize(angle - 0.0001), normalize(angle), normalize(angle + 0.0001));
  }));
  angles.sort((a, b) => a - b);
  const segments = blockers.flatMap(structureSegments);
  return angles.map((angle) => {
    let nearest = rangeM;
    let hit = { x: origin.x + Math.cos(angle) * rangeM, y: origin.y + Math.sin(angle) * rangeM };
    segments.forEach(([a, b]) => {
      const distance = rayDistance(origin, angle, a, b);
      if (distance !== undefined && distance < nearest) {
        nearest = distance;
        hit = { x: origin.x + Math.cos(angle) * distance, y: origin.y + Math.sin(angle) * distance };
      }
    });
    return hit;
  });
}

function structureSegments(structure: MapStructure): [Point, Point][] {
  const points = structure.geometry;
  if (points.length < 2) return [];
  const segments: [Point, Point][] = [];
  for (let index = 0; index < points.length - 1; index++) segments.push([points[index], points[index + 1]]);
  if (points.length > 2) segments.push([points[points.length - 1], points[0]]);
  return segments;
}

/** Distance along the ray from origin at angle to segment a–b, if it hits. */
function rayDistance(origin: Point, angle: number, a: Point, b: Point): number | undefined {
  const rx = Math.cos(angle), ry = Math.sin(angle);
  const sx = b.x - a.x, sy = b.y - a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return undefined;
  const qx = a.x - origin.x, qy = a.y - origin.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : undefined;
}
