import { describe, expect, it } from "vitest";
import type { ResolvedTokenAction, TargetOutcome } from "../api/types";
import { actionSummary, floatText } from "./actions";

const base: ResolvedTokenAction = {
  id: "a",
  name: "Action",
  kind: "attack",
  range_m: 1.5,
  area_radius_m: 0,
  ability: "",
  proficient: false,
  bonus: 0,
  save_ability: "",
  half_on_save: false,
  dice: "1d6",
  dice_bonus: 0,
  ability_to_dice: false,
  damage_type: "",
  to_hit: 0,
  save_dc: 0,
  dice_modifier: 0,
};

describe("actionSummary", () => {
  it("describes an area save with its DC, damage, radius, range and uses", () => {
    const fireball = { ...base, kind: "save" as const, save_ability: "dexterity", save_dc: 13, dice: "8d6", damage_type: "fire", half_on_save: true, area_radius_m: 6, range_m: 45, uses: { max: 3, remaining: 2 } };
    expect(actionSummary(fireball)).toBe("Dexterity save DC 13 · 8d6 fire · half on save · 6 m radius · 45 m · 2/3 uses");
    expect(actionSummary({ ...fireball, half_on_save: false, uses: null })).toBe("Dexterity save DC 13 · 8d6 fire · no damage on save · 6 m radius · 45 m");
  });

  it("describes healing with its modifier and range", () => {
    expect(actionSummary({ ...base, kind: "heal", dice: "1d8", dice_modifier: 3 })).toBe("1d8+3 healing · 1.5 m");
  });

  it("describes an item with its quantity", () => {
    const potion = { ...base, kind: "heal" as const, dice: "2d4", dice_modifier: 2, quantity: 3 };
    expect(actionSummary(potion)).toBe("2d4+2 healing · 1.5 m · ×3");
  });
});

describe("floatText", () => {
  const target: TargetOutcome = { token_id: "t", name: "Goblin", result: "hit" };

  it("shows a miss", () => {
    expect(floatText({ ...target, result: "miss" })).toEqual({ text: "Miss", tone: "miss" });
  });

  it("shows critical damage and whether the target went down", () => {
    expect(floatText({ ...target, result: "critical", damage: 12 })).toEqual({ text: "Crit -12", tone: "damage" });
    expect(floatText({ ...target, result: "critical", damage: 12, down: true })).toEqual({ text: "Crit -12 · Down", tone: "damage" });
  });

  it("shows healing as a gain", () => {
    expect(floatText({ ...target, result: "healed", healing: 5 })).toEqual({ text: "+5", tone: "heal" });
  });
});
