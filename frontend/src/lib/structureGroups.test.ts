import { describe, expect, it } from "vitest";
import type { MapStructure } from "../api/types";
import { expandToGroups, sortByZ, zOrderUpdates } from "./structureGroups";

const structure = (id: string, fields: Partial<MapStructure> = {}): MapStructure => ({
  id,
  kind: "wall",
  geometry: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  blocks_vision: true,
  blocks_movement: true,
  blocks_attacks: true,
  cover_bonus: 0,
  pass_rules: {},
  ...fields,
});

describe("structure groups", () => {
  it("expands a selection to every member of its groups", () => {
    const structures = [structure("a", { group_id: "g" }), structure("b", { group_id: "g" }), structure("c")];
    expect(expandToGroups(["a"], structures)).toEqual(["a", "b"]);
    expect(expandToGroups(["c", "b"], structures)).toEqual(["a", "b", "c"]);
  });

  it("keeps ids the structure list does not contain yet", () => {
    expect(expandToGroups(["new"], [structure("a")])).toEqual(["new"]);
  });

  it("moves the selection above or below every other structure, keeping its relative order", () => {
    const structures = [structure("x", { z_index: 1 }), structure("y", { z_index: 2 }), structure("w", { z_index: 3 })];
    expect(zOrderUpdates(["x"], structures, "front")).toEqual([{ id: "x", z_index: 4 }]);
    expect(zOrderUpdates(["w", "y"], structures, "back")).toEqual([{ id: "y", z_index: -1 }, { id: "w", z_index: 0 }]);
  });

  it("sorts by draw order and keeps ties in list order", () => {
    const structures = [structure("top", { z_index: 5 }), structure("first", { z_index: 1 }), structure("second", { z_index: 1 })];
    expect(sortByZ(structures).map((s) => s.id)).toEqual(["first", "second", "top"]);
  });
});
