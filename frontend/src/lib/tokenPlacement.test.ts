import { describe, expect, it } from "vitest";
import { placementSpot } from "./tokenPlacement";
import type { Segment } from "./segments";

describe("placementSpot", () => {
  const goblin = { center: { x: 5, y: 5 }, sizeM: 1 };

  it("keeps a free spot and only pulls it back onto the map", () => {
    expect(placementSpot({ x: 2, y: 3 }, 1, [goblin], 10, 10, [])).toEqual({ x: 2, y: 3 });
    expect(placementSpot({ x: 9.9, y: -1 }, 1, [], 10, 10, [])).toEqual({ x: 9.5, y: 0.5 });
  });

  it("moves a token dropped on another one to the nearest spot beside it", () => {
    const spot = placementSpot({ x: 5.2, y: 5 }, 1, [goblin], 10, 10, []);
    expect(Math.hypot(spot.x - 5, spot.y - 5)).toBeGreaterThanOrEqual(0.99);
    // The nearest free side is the one the drop leaned towards.
    expect(spot.x).toBeGreaterThan(5.5);
  });

  it("never moves the token through a wall to get off another one", () => {
    // A wall just right of the goblin: the free spot has to be on the drop's side.
    const wall: Segment[] = [[{ x: 5.6, y: 0 }, { x: 5.6, y: 10 }]];
    const spot = placementSpot({ x: 5.2, y: 5 }, 1, [goblin], 10, 10, wall);
    expect(spot.x).toBeLessThan(5.6);
    expect(Math.hypot(spot.x - 5, spot.y - 5)).toBeGreaterThanOrEqual(0.99);
  });

  it("stays put when nothing nearby is free", () => {
    const crowd = Array.from({ length: 400 }, (_, index) => ({ center: { x: (index % 20) * 0.5 + 0.25, y: Math.floor(index / 20) * 0.5 + 0.25 }, sizeM: 1 }));
    expect(placementSpot({ x: 5, y: 5 }, 1, crowd, 10, 10, [])).toEqual({ x: 5, y: 5 });
  });
});
