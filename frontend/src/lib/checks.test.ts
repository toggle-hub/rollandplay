import { describe, expect, it } from "vitest";
import { quickCheckGroups } from "./checks";

describe("quickCheckGroups", () => {
  it("keeps D&D saves, skills and ability checks for books with the six abilities or an unknown book", () => {
    const dnd = { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10, level: 1 };
    expect(quickCheckGroups(dnd).map((group) => group.kind)).toEqual(["save", "skill", "ability"]);
    expect(quickCheckGroups().map((group) => group.kind)).toEqual(["save", "skill", "ability"]);
  });

  it("offers one attribute check per rollable number of another book", () => {
    const groups = quickCheckGroups({ grit: 2, focus: 1, hit_points: 10, armor_class: 12, name: "x", flags: { brave: true }, Bad: 3 });
    expect(groups).toEqual([{ label: "Checks", kind: "attribute", keys: ["grit", "focus"] }]);
  });

  it("offers no checks when the book has nothing to roll", () => {
    expect(quickCheckGroups({ hit_points: 10, motto: "onward" })).toEqual([]);
  });
});
