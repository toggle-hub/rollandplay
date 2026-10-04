import { describe, expect, it } from "vitest";
import { clampStampScale, normalizeDegrees, stampGeometry } from "./structures";

describe("stamp geometry", () => {
  it("scales then rotates the kind's template about its center", () => {
    expect(stampGeometry("wall", { x: 5, y: 5 }, 1, 90, 50)).toEqual([{ x: 5, y: 4 }, { x: 5, y: 6 }]);
  });

  it("keeps stamp settings in range", () => {
    expect(normalizeDegrees(-15)).toBe(345);
    expect(normalizeDegrees(375)).toBe(15);
    expect(clampStampScale(5)).toBe(10);
    expect(clampStampScale(2000)).toBe(1000);
  });
});
