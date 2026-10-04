import type { MapStructure } from "../api/types";
import type { Point } from "./geometryTransforms";

export type Segment = [Point, Point];

const eps = 1e-9;

/** Port of the server's `structureSegments`: consecutive points, closing a polygon of three or more. */
export function structureSegments(structure: MapStructure): Segment[] {
  const points = structure.geometry;
  if (points.length < 2) return [];
  const segments: Segment[] = [];
  for (let index = 0; index < points.length - 1; index++) segments.push([points[index], points[index + 1]]);
  if (points.length > 2) segments.push([points[points.length - 1], points[0]]);
  return segments;
}

/** Port of the server's `SegmentIntersects`: touching and overlapping count. */
export function segmentsIntersect([a, b]: Segment, [c, d]: Segment) {
  const d1 = orient(a, b, c);
  const d2 = orient(a, b, d);
  const d3 = orient(c, d, a);
  const d4 = orient(c, d, b);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  return (Math.abs(d1) <= eps && onSegment(a, c, b))
    || (Math.abs(d2) <= eps && onSegment(a, d, b))
    || (Math.abs(d3) <= eps && onSegment(c, a, d))
    || (Math.abs(d4) <= eps && onSegment(c, b, d));
}

function orient(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, p: Point, b: Point) {
  return p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps
    && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
}
