import { describe, expect, it } from "vitest";
import type { ActionLists, ResolvedTokenAction, RuleBook, TargetOutcome, TokenAction, TokenAttack, TokenItem } from "../api/types";
import { actionSummary, compendiumSummary, floatText, startingLists, withPicks } from "./actions";

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

const longsword: TokenAttack = { id: "longsword", name: "Longsword", range_m: 1.5, ability: "strength", proficient: true, attack_bonus: 0, damage: "1d8", damage_bonus: 0, damage_type: "slashing" };
const effect: TokenAction = { id: "e", name: "Effect", kind: "attack", range_m: 1.5, area_radius_m: 0, ability: "intelligence", proficient: true, bonus: 0, save_ability: "", half_on_save: false, dice: "1d6", dice_bonus: 0, ability_to_dice: false, damage_type: "" };
const fireball: TokenAction = { ...effect, id: "fireball", name: "Fireball", kind: "save", range_m: 45, area_radius_m: 6, save_ability: "dexterity", half_on_save: true, dice: "8d6", damage_type: "fire" };
const cureWounds: TokenAction = { ...effect, id: "cure_wounds", name: "Cure Wounds", kind: "heal", ability: "wisdom", dice: "1d8", ability_to_dice: true };
const potion: TokenItem = { ...effect, id: "potion", name: "Potion", kind: "heal", ability: "", proficient: false, dice: "2d4", dice_bonus: 2, quantity: 1 };

describe("compendiumSummary", () => {
  it("describes weapons, saves, healing and items before modifiers", () => {
    expect(compendiumSummary(longsword)).toBe("1d8 slashing · 1.5 m");
    expect(compendiumSummary(fireball)).toBe("Dexterity save · 8d6 fire · half on save · 6 m radius · 45 m");
    expect(compendiumSummary(cureWounds)).toBe("Healing · 1d8 + modifier · 1.5 m");
    expect(compendiumSummary(potion)).toBe("Healing · 2d4+2 · 1.5 m · ×1");
  });
});

describe("withPicks", () => {
  it("replaces a value entry with a same-id pick and keeps the others", () => {
    const dagger = { ...longsword, id: "dagger", name: "Dagger" };
    const values: ActionLists = { attacks: [longsword, dagger], actions: [], items: [] };
    const picks: ActionLists = { attacks: [{ ...longsword, damage_bonus: 1 }], actions: [fireball], items: [] };
    expect(withPicks(values, picks)).toEqual({ attacks: [dagger, { ...longsword, damage_bonus: 1 }], actions: [fireball], items: [] });
  });
});

describe("startingLists", () => {
  it("maps a class kit to compendium entries in kit order and skips unknown ids", () => {
    const axe = { ...longsword, id: "axe", name: "Axe" };
    const book = {
      creation_rules: { classes: [{ id: "brute", name: "Brute", defaults: {}, starting_equipment: { attacks: ["axe", "missing", "longsword"], items: ["potion"] } }] },
      compendium: { attacks: [longsword, axe], actions: [fireball], items: [potion] },
    } as unknown as RuleBook;
    expect(startingLists(book, "brute")).toEqual({ attacks: [axe, longsword], actions: [], items: [potion] });
    expect(startingLists(book)).toEqual({ attacks: [], actions: [], items: [] });
  });
});
