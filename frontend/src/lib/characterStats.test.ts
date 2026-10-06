import { describe, expect, it } from "vitest";
import { checkBonus, derivedStartingValues, proficiencyForLevel } from "./characterStats";

const fighter = { level: 1, hit_die: 10, constitution: 14, dexterity: 12, max_hit_points: 0, hit_points: 0, armor_class: 10, initiative: 0, proficiency_bonus: 2 };

describe("derivedStartingValues", () => {
  it("derives level 1 values from the hit die and ability modifiers", () => {
    const derived = derivedStartingValues(fighter);
    expect(derived.max_hit_points?.value).toBe(12);
    expect(derived.hit_points?.value).toBe(12);
    expect(derived.armor_class?.value).toBe(11);
    expect(derived.initiative?.value).toBe(1);
    expect(derived.proficiency_bonus?.value).toBe(2);
  });

  it("adds the fixed hit point gain per level and never less than 1 per level", () => {
    expect(derivedStartingValues({ ...fighter, level: 5 }).max_hit_points?.value).toBe(12 + 4 * 8);
    expect(derivedStartingValues({ ...fighter, hit_die: 6, constitution: 1 }).max_hit_points?.value).toBe(1);
    expect(derivedStartingValues({ ...fighter, level: 5 }).proficiency_bonus?.value).toBe(3);
  });

  it("current hit points follow an edited maximum", () => {
    expect(derivedStartingValues({ ...fighter, max_hit_points: 20 }, new Set(["max_hit_points"])).hit_points?.value).toBe(20);
  });

  it("derives nothing the character doesn't track or can't compute", () => {
    const derived = derivedStartingValues({ dexterity: 14, level: 0, constitution: 10, max_hit_points: 0 });
    expect(derived).toEqual({});
  });
});

describe("proficiencyForLevel", () => {
  it("follows the 5e table", () => {
    expect([1, 4, 5, 8, 9, 13, 17, 20].map(proficiencyForLevel)).toEqual([2, 2, 3, 3, 4, 5, 6, 6]);
  });
});

describe("checkBonus", () => {
  it("adds proficiency only when the group marks the key", () => {
    const stats = { wisdom: 14, proficiency_bonus: 3, skill_proficiencies: { perception: true, insight: false } };
    expect(checkBonus(stats, "wisdom", "skill_proficiencies", "perception")).toBe(5);
    expect(checkBonus(stats, "wisdom", "skill_proficiencies", "insight")).toBe(2);
  });
});
