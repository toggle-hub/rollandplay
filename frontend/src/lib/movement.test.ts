import { describe, expect, it } from "vitest";
import type { MapStructure } from "../api/types";
import type { Point } from "./geometryTransforms";
import { extendPath, legBlocked, movementBarriers, walkToken } from "./movement";

const wall: MapStructure = {
  id: "wall",
  kind: "wall",
  geometry: [{ x: 3, y: 0 }, { x: 3, y: 4 }],
  blocks_vision: true,
  blocks_movement: true,
  blocks_attacks: true,
  cover_bonus: 0,
  pass_rules: {},
} as MapStructure;
const barriers = movementBarriers([wall]);
const free = (point: Point) => point;

describe("token walking", () => {
  it("stops a token walking into a wall next to it, a radius short", () => {
    expect(walkToken({ x: 1, y: 1 }, { x: 5, y: 1 }, 0.5, barriers, free)).toEqual([{ x: 2.5, y: 1 }]);
  });

  it("rests a token that crept up to a wall a radius off it once it walks into the wall", () => {
    expect(walkToken({ x: 2.8, y: 1 }, { x: 3.2, y: 1 }, 0.5, barriers, free)).toEqual([{ x: 2.5, y: 1 }]);
  });

  it("slides the rest of an angled walk along the wall", () => {
    expect(walkToken({ x: 1, y: 1 }, { x: 5, y: 3 }, 0.5, barriers, free)).toEqual([{ x: 2.5, y: 1.75 }, { x: 2.5, y: 3 }]);
  });

  it("slides around the wall's end and keeps every leg clear", () => {
    const route = walkToken({ x: 2.5, y: 3 }, { x: 5, y: 6 }, 0.5, barriers, free);
    expect(route[route.length - 1]).toEqual({ x: 5, y: 6 });
    [{ x: 2.5, y: 3 }, ...route].reduce((from, to) => {
      expect(legBlocked(from, to, barriers)).toBe(false);
      return to;
    });
  });

  it("ignores walls that let movement pass or are hidden", () => {
    expect(movementBarriers([{ ...wall, pass_rules: { movement: true } }, { ...wall, is_hidden: true }])).toEqual([]);
  });

  it("keeps only the corners a walked path needs to stay clear of walls", () => {
    const path = [{ x: 1, y: 1 }];
    [{ x: 1, y: 3 }, { x: 1, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 1 }].forEach((point) => extendPath(path, point, barriers));
    expect(path).toEqual([{ x: 1, y: 1 }, { x: 1, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 1 }]);
  });
});
