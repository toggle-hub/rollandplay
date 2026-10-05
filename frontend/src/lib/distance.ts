import type { Point } from "./geometryTransforms";

/** Meters along a walked route, corner to corner. */
export function pathLength(path: readonly Point[]) {
  let meters = 0;
  for (let index = 1; index < path.length; index++) {
    meters += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
  }
  return meters;
}

/** Meters to one decimal place, without a trailing ".0": "6", "4.2". */
export function formatMeters(meters: number) {
  const tenths = Math.round(meters * 10) / 10;
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}

/** "6 m · 4 squares": meters to one decimal place, squares to the nearest whole one. */
export function distanceLabel(meters: number, gridM: number) {
  const squares = gridM > 0 ? Math.round(meters / gridM) : 0;
  return `${formatMeters(meters)} m · ${squares} ${squares === 1 ? "square" : "squares"}`;
}
