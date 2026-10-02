import { describe, expect, it } from "vitest";
import { monsterDrafts, monstersFromDrafts, newMonsterDraft } from "./monsters";

const goblin = { id: "goblin", name: "Goblin", description: "Nimble", size_m: 1.5, stats: { hit_points: 7, attacks: [{ id: "scimitar", name: "Scimitar" }] } };

describe("monster drafts", () => {
  it("round trips existing monsters unchanged", () => {
    expect(monstersFromDrafts(monsterDrafts([goblin]))).toEqual([goblin]);
  });

  it("derives unique ids for new monsters from their names", () => {
    const drafts = [...monsterDrafts([goblin]), { ...newMonsterDraft({}), name: "  Goblin " }, { ...newMonsterDraft({}), name: "Giant Rat!" }];
    expect(monstersFromDrafts(drafts).map((monster) => [monster.id, monster.name])).toEqual([["goblin", "Goblin"], ["goblin_2", "Goblin"], ["giant_rat", "Giant Rat!"]]);
  });

  it("starts new monsters from the book's combat attributes only", () => {
    const [monster] = monstersFromDrafts([{ ...newMonsterDraft({ strength: 10, armor_class: 10, level: 1, inspiration: false }), name: "Brute" }]);
    expect(monster.stats).toEqual({ strength: 10, armor_class: 10, attacks: [] });
    expect(monster.size_m).toBe(1.5);
  });

  it("rejects unnamed monsters and impossible sizes", () => {
    expect(() => monstersFromDrafts([newMonsterDraft({})])).toThrow(/give it a name/);
    expect(() => monstersFromDrafts([{ ...newMonsterDraft({}), name: "Speck", size: "0" }])).toThrow(/size/);
    expect(() => monstersFromDrafts([{ ...newMonsterDraft({}), name: "Titan", size: "31" }])).toThrow(/size/);
  });
});
