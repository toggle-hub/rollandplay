import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenAttack } from "../api/types";
import { ActionsEditor } from "./ActionsEditor";

const longsword: TokenAttack = { id: "longsword", name: "Longsword", range_m: 1.5, ability: "strength", proficient: true, attack_bonus: 0, damage: "1d8", damage_bonus: 0, damage_type: "slashing" };

describe("ActionsEditor", () => {
  afterEach(cleanup);

  it("adds a compendium weapon and stops offering it", () => {
    const onSave = vi.fn();
    render(<ActionsEditor owner={{ id: "hero", name: "Hero" }} compendium={{ attacks: [longsword], actions: [], items: [] }} busy={false} onSave={onSave} onClose={vi.fn()} />);
    const picker = screen.getByRole("combobox", { name: "Compendium weapon" });
    fireEvent.change(picker, { target: { value: "longsword" } });
    fireEvent.click(screen.getByRole("button", { name: "Add compendium weapon" }));
    expect(within(picker).queryByRole("option", { name: /Longsword/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save actions" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].attacks[0]).toMatchObject({ id: "longsword", name: "Longsword", damage: "1d8", range_m: 1.5 });
  });
});
