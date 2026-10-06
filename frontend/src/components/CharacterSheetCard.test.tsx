import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sheet } from "../api/types";
import { CharacterSheetCard } from "./CharacterSheetCard";

const longsword = { id: "longsword", name: "Longsword", range_m: 1.5, ability: "strength", proficient: true, attack_bonus: 0, damage: "1d8", damage_bonus: 0, damage_type: "slashing" };
const sheet: Sheet = {
  id: "s1", rule_book_id: "book", user_id: "me", name: "Ada", is_public: true, creation: {},
  data: { class: "Fighter", level: 1, strength: 16, hit_points: 12, max_hit_points: 12, armor_class: 16, proficiency_bonus: 2, attacks: [longsword] },
};

function renderCard(isOwner: boolean) {
  const handlers = { onRename: vi.fn(), onSaveData: vi.fn().mockResolvedValue(undefined), onSaveLists: vi.fn(), onDelete: vi.fn().mockResolvedValue(undefined) };
  render(<CharacterSheetCard sheet={sheet} isOwner={isOwner} {...handlers} />);
  return handlers;
}

describe("CharacterSheetCard", () => {
  afterEach(cleanup);

  it("shows worked-out stats instead of raw data", () => {
    renderCard(false);
    fireEvent.click(screen.getByRole("button", { name: "View character" }));
    expect(screen.getByLabelText("Strength 16, modifier +3")).toBeInTheDocument();
    expect(screen.getByText(/\+5 to hit · 1d8\+3 slashing/)).toBeInTheDocument();
  });

  it("lets only the owner edit, rename or delete", () => {
    renderCard(false);
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Character name")).not.toBeInTheDocument();
  });

  it("saves edited values with the attacks kept", async () => {
    const { onSaveData } = renderCard(true);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await vi.waitFor(() => expect(onSaveData).toHaveBeenCalledTimes(1));
    expect(onSaveData.mock.calls[0][0]).toMatchObject({ level: 2, strength: 16, attacks: [longsword] });
  });

  it("deletes only after the player confirms", async () => {
    const { onDelete } = renderCard(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    confirm.mockRestore();
  });
});
