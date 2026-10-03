import type { Point } from "./geometryTransforms";
import { placed } from "./structures";

/** Snaps a token center so its footprint covers whole grid cells, kept inside the map. */
export function snapTokenCenter(point: Point, sizeM: number, gridM: number, mapWidthM: number, mapHeightM: number): Point {
  const grid = Math.max(gridM || 1, 0.25);
  const cells = Math.max(1, Math.round(sizeM / grid));
  const half = (cells * grid) / 2;
  const axis = (value: number, extent: number) => {
    // An odd footprint centers on a cell; an even one centers on a grid line.
    const snapped = cells % 2 === 1 ? (Math.floor(value / grid) + 0.5) * grid : Math.round(value / grid) * grid;
    return placed(clamp(snapped, half, Math.max(half, extent - half)));
  };
  return { x: axis(point.x, mapWidthM), y: axis(point.y, mapHeightM) };
}

/** Keeps a token center far enough from the map edges for the whole token to stay on the map. */
export function clampTokenCenter(point: Point, sizeM: number, mapWidthM: number, mapHeightM: number): Point {
  const half = sizeM / 2;
  return {
    x: placed(clamp(point.x, half, Math.max(half, mapWidthM - half))),
    y: placed(clamp(point.y, half, Math.max(half, mapHeightM - half))),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
