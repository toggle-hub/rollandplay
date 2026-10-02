import type { Point } from "./geometryTransforms";

export type StructureBlocks = { blocks_vision: boolean; blocks_movement: boolean; blocks_attacks: boolean };

export const wallBlocks: StructureBlocks = { blocks_vision: true, blocks_movement: true, blocks_attacks: true };

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
