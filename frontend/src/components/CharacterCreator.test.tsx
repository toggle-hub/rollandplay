import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuleBook } from "../api/types";
import { CharacterCreator } from "./CharacterCreator";
import { ToastProvider } from "./Toast";

const book: RuleBook = {
  id: "book",
  owner_id: null,
  name: "Test Rules",
  is_public: true,
  attributes: {},
  creation_rules: { classes: [{ id: "fighter", name: "Fighter", defaults: {}, starting_equipment: { attacks: ["longsword"] } }] },
  monsters: [],
  compendium: {
    attacks: [{ id: "longsword", name: "Longsword", range_m: 1.5, ability: "strength", proficient: true, attack_bonus: 0, damage: "1d8", damage_bonus: 0, damage_type: "slashing" }],
    actions: [{ id: "fire_bolt", name: "Fire Bolt", kind: "attack", range_m: 36, area_radius_m: 0, ability: "intelligence", proficient: true, bonus: 0, save_ability: "", half_on_save: false, dice: "1d10", dice_bonus: 0, ability_to_dice: false, damage_type: "fire" }],
    items: [],
  },
} as RuleBook;

describe("CharacterCreator", () => {
  afterEach(cleanup);

  it("pre-picks the class kit and sends compendium picks with the sheet", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><ToastProvider><CharacterCreator books={[book]} onCreate={onCreate} /></ToastProvider></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "fighter" } });
    expect(screen.getByRole("checkbox", { name: /Longsword/ })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /Fire Bolt/ }));
    fireEvent.change(screen.getByLabelText("Character name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Create character" }));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const data = onCreate.mock.calls[0][2];
    expect(data.attacks[0].id).toBe("longsword");
    expect(data.actions[0].id).toBe("fire_bolt");
  });
});
