import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuleBook } from "../api/types";
import { CharacterCreator } from "./CharacterCreator";
import { ToastProvider } from "./Toast";

const costs = { "8": 0, "9": 1, "10": 2, "11": 3, "12": 4, "13": 5, "14": 7, "15": 9 };
const book: RuleBook = {
  id: "book",
  owner_id: null,
  name: "Test Rules",
  is_public: true,
  attributes: { level: 1, proficiency_bonus: 2, armor_class: 10, initiative: 0, hit_points: 0, max_hit_points: 0 },
  creation_rules: {
    classes: [
      { id: "fighter", name: "Fighter", defaults: { hit_die: 10 }, starting_equipment: { attacks: ["longsword"] }, spell_list: [] },
      { id: "wizard", name: "Wizard", defaults: { hit_die: 6 }, spell_list: ["fire_bolt"] },
    ],
    point_buy: { attributes: ["strength", "dexterity", "constitution"], min: 8, max: 15, budget: 27, costs, bonus_budget: 3, bonus_max: 2 },
  },
  monsters: [],
  compendium: {
    attacks: [{ id: "longsword", name: "Longsword", range_m: 1.5, ability: "strength", proficient: true, attack_bonus: 0, damage: "1d8", damage_bonus: 0, damage_type: "slashing" }],
    actions: [
      { id: "fire_bolt", name: "Fire Bolt", kind: "attack", range_m: 36, area_radius_m: 0, ability: "intelligence", proficient: true, bonus: 0, save_ability: "", half_on_save: false, dice: "1d10", dice_bonus: 0, ability_to_dice: false, damage_type: "fire" },
      { id: "cure_wounds", name: "Cure Wounds", kind: "heal", range_m: 1.5, area_radius_m: 0, ability: "wisdom", proficient: false, bonus: 0, save_ability: "", half_on_save: false, dice: "1d8", dice_bonus: 0, ability_to_dice: true, damage_type: "" },
    ],
    items: [],
  },
} as RuleBook;

function renderCreator() {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(<MemoryRouter><ToastProvider><CharacterCreator books={[book]} onCreate={onCreate} /></ToastProvider></MemoryRouter>);
  return onCreate;
}
// getByRole walks the whole accessibility tree; these lookups stay fast enough for the full suite.
const next = () => fireEvent.click(screen.getByText(/^Next:/));
function raise(ability: string, times: number) {
  for (let i = 0; i < times; i++) fireEvent.click(screen.getByLabelText(`Increase ${ability} base score`));
}
function toAbilities(classId: string) {
  fireEvent.change(screen.getByLabelText("Character name"), { target: { value: "Ada" } });
  next();
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: classId } });
  next();
}

describe("CharacterCreator", () => {
  afterEach(cleanup);

  it("pre-picks the class kit, offers only the class's spells and sends the picks with the sheet", async () => {
    const onCreate = renderCreator();
    toAbilities("wizard");
    next();
    expect(screen.getByLabelText(/Fire Bolt/)).not.toBeChecked();
    expect(screen.queryByLabelText(/Cure Wounds/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Fire Bolt/));
    fireEvent.click(screen.getByLabelText(/Longsword/));
    next();
    fireEvent.click(screen.getByText("Create character"));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const data = onCreate.mock.calls[0][2];
    expect(data.actions.map((entry: { id: string }) => entry.id)).toEqual(["fire_bolt"]);
    expect(data.attacks.map((entry: { id: string }) => entry.id)).toEqual(["longsword"]);
  });

  it("works out hit points, armor class and initiative, and keeps values the player typed", async () => {
    const onCreate = renderCreator();
    toAbilities("fighter");
    expect(screen.getByLabelText("Max hit points")).toHaveValue(9); // d10 + CON 8 (−1)
    raise("Constitution", 6); // 14 → +2
    raise("Dexterity", 6); // 14 → +2
    expect(screen.getByLabelText("Max hit points")).toHaveValue(12);
    expect(screen.getByLabelText("Current hit points")).toHaveValue(12);
    expect(screen.getByLabelText("Armor class")).toHaveValue(12);
    expect(screen.getByLabelText("Initiative bonus")).toHaveValue(2);
    expect(screen.getByLabelText("Proficiency bonus")).toHaveValue(2);

    fireEvent.change(screen.getByLabelText("Max hit points"), { target: { value: "15" } });
    fireEvent.click(screen.getByLabelText("Increase Constitution bonus"));
    fireEvent.click(screen.getByLabelText("Increase Constitution bonus")); // 16 → +3
    expect(screen.getByLabelText("Max hit points")).toHaveValue(15);
    expect(screen.getByLabelText("Current hit points")).toHaveValue(15);

    next();
    next();
    fireEvent.click(screen.getByText("Create character"));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][2]).toMatchObject({ max_hit_points: 15, hit_points: 15, armor_class: 12, initiative: 2, constitution: 16, hit_die: 10 });
  });

  it("shows a missing class once, next to the class field, and focuses it", () => {
    const onCreate = renderCreator();
    fireEvent.change(screen.getByLabelText("Character name"), { target: { value: "Ada" } });
    next();
    next();
    const select = screen.getByLabelText("Class");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a class for your character.");
    expect(select).toHaveAttribute("aria-describedby", "character-class-error");
    expect(select).toHaveFocus();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("sends the player back to the step with a missing class when creating from the review", () => {
    renderCreator();
    fireEvent.change(screen.getByLabelText("Character name"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByText(/\. Review$/));
    fireEvent.click(screen.getByText("Create character"));
    expect(screen.getByLabelText("Class")).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a class");
  });
});
