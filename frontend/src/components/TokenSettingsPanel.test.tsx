import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomToken } from "../api/types";
import { TokenSettingsPanel } from "./TokenSettingsPanel";

const goblin: RoomToken = {
  id: "goblin", owner_user_id: "dm", name: "Goblin", x_m: 1, y_m: 1, size_m: 1, rotation_deg: 0, vision_range_m: 12, is_hidden: false, attributes: {},
  hit_points: 7, max_hit_points: 7, defenses: { armor_class: 15, resistances: [], immunities: [], vulnerabilities: [] }, conditions: [], side: "npc",
};

function panel(token: RoomToken, onSave = vi.fn(), onSend = vi.fn(() => true)) {
  return <TokenSettingsPanel token={token} isDM canManage members={[]} busy={false} onSave={onSave} onUploadImage={vi.fn()} onClearImage={vi.fn()} onSend={onSend} />;
}

describe("TokenSettingsPanel", () => {
  afterEach(cleanup);

  it("keeps damage dealt while the card is open when another setting is saved", () => {
    const onSave = vi.fn();
    const { rerender } = render(panel(goblin, onSave));
    // A hit lands while the game master has the card open.
    rerender(panel({ ...goblin, hit_points: 2 }, onSave));
    expect(screen.getByLabelText("Current HP")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("Armor class"), { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ armor_class: 13 });
  });

  it("keeps an edit in progress when the server value changes", () => {
    const onSave = vi.fn();
    const { rerender } = render(panel(goblin, onSave));
    fireEvent.change(screen.getByLabelText("Current HP"), { target: { value: "5" } });
    rerender(panel({ ...goblin, hit_points: 3, defenses: { ...goblin.defenses!, armor_class: 12 } }, onSave));
    expect(screen.getByLabelText("Current HP")).toHaveValue(5);
    expect(screen.getByLabelText("Armor class")).toHaveValue(12);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ hit_points: 5 });
  });

  it("sends quick damage and healing as amounts", () => {
    const onSend = vi.fn(() => true);
    render(panel(goblin, vi.fn(), onSend));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Damage" }));
    expect(onSend).toHaveBeenLastCalledWith("token.health", { tokenId: "goblin", damage: 4 });
    expect(screen.getByLabelText("Amount")).toHaveValue(null);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Heal" })).toBeDisabled();
  });

  it("adds a 5e condition and a typed one without duplicates", () => {
    const onSave = vi.fn();
    render(panel({ ...goblin, conditions: ["prone"] }, onSave));
    fireEvent.change(screen.getByLabelText("Your own condition"), { target: { value: "PRONE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add your own condition" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Add a condition"), { target: { value: "poisoned" } });
    expect(onSave).toHaveBeenLastCalledWith({ conditions: ["prone", "poisoned"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove Prone" }));
    expect(onSave).toHaveBeenLastCalledWith({ conditions: [] });
  });
});
