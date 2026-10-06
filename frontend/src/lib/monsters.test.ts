import { describe, expect, it } from "vitest";
import { monsterDrafts, monstersFromDrafts, newMonsterDraft } from "./monsters";
import { fieldFromValue } from "./attributeFields";

const scimitar = { id: "scimitar", name: "Scimitar", range_m: 1.5, ability: "dexterity", proficient: true, attack_bonus: 0, damage: "1d6", damage_bonus: 0, damage_type: "slashing" };
const goblin = { id: "goblin", name: "Goblin", description: "Nimble", size_m: 1.5, stats: { hit_points: 7, attacks: [scimitar] } };

describe("monster drafts", () => {
  it("round trips existing monsters unchanged", () => {
    expect(monstersFromDrafts(monsterDrafts([goblin]))).toEqual([goblin]);
  });

  it("edits attacks, spells and items apart from the plain stats", () => {
    const [draft] = monsterDrafts([goblin]);
    expect(draft.stats.map((field) => field.name)).toEqual(["hit_points"]);
    expect(draft.lists.attacks).toEqual([scimitar]);
    const heal = { ...scimitar, id: "salve", name: "Salve", kind: "heal" as const, area_radius_m: 0, bonus: 0, save_ability: "", half_on_save: false, dice: "1d4", dice_bonus: 0, ability_to_dice: false, damage_type: "", quantity: 2 };
    const [monster] = monstersFromDrafts([{ ...draft, lists: { attacks: [], actions: [], items: [heal] } }]);
    expect(monster.stats).toEqual({ hit_points: 7, items: [heal] });
  });

  it("refuses a stat that would overwrite the attacks list", () => {
    const [draft] = monsterDrafts([goblin]);
    expect(() => monstersFromDrafts([{ ...draft, stats: [...draft.stats, fieldFromValue("attacks", [])] }])).toThrow(/Attacks & abilities/);
  });

  it("derives unique ids for new monsters from their names", () => {
    const drafts = [...monsterDrafts([goblin]), { ...newMonsterDraft({}), name: "  Goblin " }, { ...newMonsterDraft({}), name: "Giant Rat!" }];
    expect(monstersFromDrafts(drafts).map((monster) => [monster.id, monster.name])).toEqual([["goblin", "Goblin"], ["goblin_2", "Goblin"], ["giant_rat", "Giant Rat!"]]);
  });

  it("starts new monsters from the book's combat attributes only", () => {
    const [monster] = monstersFromDrafts([{ ...newMonsterDraft({ strength: 10, armor_class: 10, level: 1, inspiration: false }), name: "Brute" }]);
    expect(monster.stats).toEqual({ strength: 10, armor_class: 10 });
    expect(monster.size_m).toBe(1.5);
  });

  it("rejects unnamed monsters and impossible sizes", () => {
    expect(() => monstersFromDrafts([newMonsterDraft({})])).toThrow(/give it a name/);
    expect(() => monstersFromDrafts([{ ...newMonsterDraft({}), name: "Speck", size: "0" }])).toThrow(/size/);
    expect(() => monstersFromDrafts([{ ...newMonsterDraft({}), name: "Titan", size: "31" }])).toThrow(/size/);
  });
});
