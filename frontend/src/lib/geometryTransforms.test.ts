import { describe, expect, it } from "vitest";
import { flipGeometry, geometryBounds, nudgeGeometry, rotateGeometry, scaleGeometry } from "./geometryTransforms";

describe("geometry transforms", () => {
  it("rotates structure points around their bounding-box center", () => {
    expect(rotateGeometry([{ x: 4, y: 4 }, { x: 10, y: 4 }], 90)).toEqual([{ x: 7, y: 1 }, { x: 7, y: 7 }]);
  });

  it("rotates structure points around an explicit anchor", () => {
    expect(rotateGeometry([{ x: 4, y: 4 }, { x: 10, y: 4 }], 45, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }, { x: 8.24, y: 8.24 }]);
  });

  it("scales and nudges structure geometry without mutating JSON points", () => {
    const geometry = [{ x: 4, y: 4 }, { x: 10, y: 4 }];
    expect(scaleGeometry(geometry, 0.5)).toEqual([{ x: 5.5, y: 4 }, { x: 8.5, y: 4 }]);
    expect(nudgeGeometry(geometry, 1, -2)).toEqual([{ x: 5, y: 2 }, { x: 11, y: 2 }]);
    expect(geometry).toEqual([{ x: 4, y: 4 }, { x: 10, y: 4 }]);
    expect(scaleGeometry(geometry, 1.5, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }, { x: 13, y: 4 }]);
  });

  it("reports re-dimensioned bounds", () => {
    expect(geometryBounds([{ x: 1, y: 2 }, { x: 4, y: 6 }])).toEqual({ width: 3, height: 4 });
  });

  it("mirrors geometry across its center", () => {
    expect(flipGeometry([{ x: 1, y: 0 }, { x: 3, y: 2 }], "horizontal")).toEqual([{ x: 3, y: 0 }, { x: 1, y: 2 }]);
    expect(flipGeometry([{ x: 1, y: 0 }, { x: 3, y: 2 }], "vertical")).toEqual([{ x: 1, y: 2 }, { x: 3, y: 0 }]);
  });
});
