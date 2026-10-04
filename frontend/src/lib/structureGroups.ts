import type { MapStructure } from "../api/types";
import { geometryCenter, type Point } from "./geometryTransforms";

/** `ids` plus every structure sharing a group with one of them, in `structures` order, without duplicates. */
export function expandToGroups(ids: string[], structures: MapStructure[]): string[] {
  const wanted = new Set(ids);
  const groups = new Set<string>();
  for (const structure of structures) {
    if (wanted.has(structure.id) && structure.group_id) groups.add(structure.group_id);
  }
  const known = new Set<string>();
  const expanded: string[] = [];
  for (const structure of structures) {
    if (wanted.has(structure.id) || (structure.group_id && groups.has(structure.group_id))) {
      expanded.push(structure.id);
      known.add(structure.id);
    }
  }
  // Keep ids the list does not know (yet), so callers never silently lose part of a selection.
  for (const id of ids) {
    if (!known.has(id)) {
      expanded.push(id);
      known.add(id);
    }
  }
  return expanded;
}

const zOf = (structure: MapStructure) => structure.z_index ?? 0;

/** Stable sort by draw order: the first structure draws at the bottom. */
export function sortByZ(structures: MapStructure[]): MapStructure[] {
  return structures
    .map((structure, index) => ({ structure, index }))
    .sort((a, b) => zOf(a.structure) - zOf(b.structure) || a.index - b.index)
    .map(({ structure }) => structure);
}

/** New z_index values that move the selected structures above (front) or below (back) every other one. */
export function zOrderUpdates(ids: string[], structures: MapStructure[], direction: "front" | "back"): { id: string; z_index: number }[] {
  if (structures.length === 0) return [];
  const selected = new Set(ids);
  const moving = sortByZ(structures).filter((structure) => selected.has(structure.id));
  const zs = structures.map(zOf);
  if (direction === "front") {
    const top = Math.max(...zs);
    return moving.map((structure, index) => ({ id: structure.id, z_index: top + index + 1 }));
  }
  const bottom = Math.min(...zs);
  return moving.map((structure, index) => ({ id: structure.id, z_index: bottom - moving.length + index }));
}

/** Bounding-box center of every point in the structures. */
export function selectionCenter(structures: MapStructure[]): Point {
  return geometryCenter(structures.flatMap((structure) => structure.geometry));
}
