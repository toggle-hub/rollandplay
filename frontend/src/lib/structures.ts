import type { MapStructure } from "../api/types";
import { geometryCenter, rotateGeometry, scaleGeometry, type Point } from "./geometryTransforms";

export type StructureBlocks = { blocks_vision: boolean; blocks_movement: boolean; blocks_attacks: boolean };

export const wallBlocks: StructureBlocks = { blocks_vision: true, blocks_movement: true, blocks_attacks: true };

/** Port of the server's `Structure.Passable`: hidden structures and open doors block nothing at the table. */
export function structurePassable(structure: Pick<MapStructure, "kind" | "is_hidden" | "is_open">) {
  return !!structure.is_hidden || (structure.kind === "door" && !!structure.is_open);
}

export const structureTypes = [
  { value: "wall", label: "Wall", hint: "Long barrier", swatch: "bg-[var(--purple)]" },
  { value: "door", label: "Door", hint: "Short opening", swatch: "bg-[var(--peach)]" },
  { value: "window", label: "Window", hint: "Sight gap", swatch: "bg-[var(--lavender)]" },
  { value: "terrain", label: "Terrain", hint: "Area shape", swatch: "bg-[var(--green)]" },
  { value: "cover", label: "Cover", hint: "Defensive edge", swatch: "bg-[var(--pink)]" },
];

export function templateGeometry(kind: string, point: Point, gridSize: number): Point[] {
  const grid = Math.max(gridSize || 1, 0.25);
  const x = snap(point.x, grid);
  const y = snap(point.y, grid);
  const halfShort = grid / 2;
  const halfMedium = grid;
  const halfLong = grid * 2;
  if (kind === "door" || kind === "window") return [{ x: placed(x - halfShort), y }, { x: placed(x + halfShort), y }];
  if (kind === "terrain") return [
    { x: placed(x - halfMedium), y: placed(y - halfMedium) },
    { x: placed(x + halfMedium), y: placed(y - halfMedium) },
    { x: placed(x + halfMedium), y: placed(y + halfMedium) },
    { x: placed(x - halfMedium), y: placed(y + halfMedium) },
    { x: placed(x - halfMedium), y: placed(y - halfMedium) },
  ];
  if (kind === "cover") return [{ x: placed(x - halfMedium), y }, { x: placed(x + halfMedium), y }];
  return [{ x: placed(x - halfLong), y }, { x: placed(x + halfLong), y }];
}

/** The structure the Place tool stamps at `point`: the kind's template, scaled then rotated about its center. */
export function stampGeometry(kind: string, point: Point, gridSize: number, rotationDeg: number, scalePercent: number): Point[] {
  const template = templateGeometry(kind, point, gridSize);
  const center = geometryCenter(template);
  return rotateGeometry(scaleGeometry(template, scalePercent / 100, center), rotationDeg, center);
}

export const clampStampScale = (value: number) => Math.min(1000, Math.max(10, Math.round(value)));

export const normalizeDegrees = (value: number) => ((Math.round(value) % 360) + 360) % 360;

export function snap(value: number, grid: number) {
  return placed(Math.round(value / grid) * grid);
}

export function placed(value: number) {
  return Math.round(value * 100) / 100;
}

export function defaultBlocksForKind(kind: string): StructureBlocks {
  if (kind === "window") return { blocks_vision: false, blocks_movement: true, blocks_attacks: false };
  return wallBlocks;
}

export function structureLabel(kind: string) {
  const type = structureTypes.find((structureType) => structureType.value === kind);
  return type?.label ?? kind[0]?.toUpperCase() + kind.slice(1);
}
