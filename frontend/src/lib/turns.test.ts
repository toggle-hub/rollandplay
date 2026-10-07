import { describe, expect, it } from "vitest";
import type { Combat } from "../api/types";
import { offTurnTokenIds, turnBlockReason } from "./turns";

const combat = (current: string | null, used = 0, allowed = 1): Combat => ({
  round: 1,
  current_combatant_id: current,
  actions_used: used,
  actions_allowed: allowed,
  moved_m: 0,
  combatants: [
    { id: "c-hero", token_id: "hero", name: "Hero", initiative: 15, player_user_id: "player", is_hidden: false },
    { id: "c-goblin", token_id: "goblin", name: "Goblin", initiative: 10, player_user_id: "dm", is_hidden: false },
  ],
});

describe("offTurnTokenIds", () => {
  it("never locks a game master's tokens", () => {
    expect(offTurnTokenIds(combat("c-hero"), true).size).toBe(0);
  });

  it("locks every fighter but the current one for players", () => {
    expect([...offTurnTokenIds(combat("c-hero"), false)]).toEqual(["goblin"]);
  });

  it("locks every fighter while nobody visible has the turn", () => {
    expect([...offTurnTokenIds(combat(null), false)].sort()).toEqual(["goblin", "hero"]);
  });
});

describe("turnBlockReason", () => {
  it("blocks a fighter off its turn", () => {
    expect(turnBlockReason(combat("c-goblin"), false, "hero")).toBe("Not this character's turn");
  });

  it("blocks once the turn's actions are used, until another is allowed", () => {
    expect(turnBlockReason(combat("c-hero", 1, 1), false, "hero")).toBe("Action used this turn");
    expect(turnBlockReason(combat("c-hero", 1, 2), false, "hero")).toBeUndefined();
  });

  it("leaves tokens outside the fight and game masters alone", () => {
    expect(turnBlockReason(combat("c-goblin"), false, "wolf")).toBeUndefined();
    expect(turnBlockReason(combat("c-goblin"), true, "hero")).toBeUndefined();
  });
});
