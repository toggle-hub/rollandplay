import { describe, expect, it } from "vitest";
import { creationRulesDraft, rulesFromDraft } from "./creationRulesConfig";

describe("class ids", () => {
  it("derives a new class's id from its name and keeps a saved class's id when it is renamed", () => {
    const draft = creationRulesDraft({ classes: [{ id: "knight", name: "Knight", defaults: {} }] });
    const blank = { ...draft.classes[0], key: "new", id: "", name: "Knight Errant" };
    const twin = { ...draft.classes[0], key: "twin", id: "", name: "Knight!" };
    const rules = rulesFromDraft({ ...draft, classes: [{ ...draft.classes[0], name: "Paladin" }, blank, twin] });
    expect(rules.classes?.map((cls) => [cls.id, cls.name])).toEqual([["knight", "Paladin"], ["knight_errant", "Knight Errant"], ["knight_2", "Knight!"]]);
  });
});
