import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreationRules } from "../api/types";
import { CharacterCreationControls } from "./CharacterCreationControls";

const rules: CreationRules = {
  point_buy: {
    attributes: ["strength"],
    min: 8,
    max: 15,
    budget: 2,
    costs: { "8": 0, "9": 1, "10": 2, "11": 3, "12": 4, "13": 5, "14": 7, "15": 9 },
    bonus_budget: 0,
    bonus_max: 0,
  },
};

describe("CharacterCreationControls", () => {
  afterEach(cleanup);

  it("steps base scores within the point budget", () => {
    const onChange = vi.fn();
    const { rerender } = render(<CharacterCreationControls rules={rules} creation={{ scores: { strength: 9 }, bonuses: { strength: 0 } }} onChange={onChange} onClassChange={vi.fn()} />);
    const increase = screen.getByRole("button", { name: "Increase Strength base score" });
    expect(increase).toBeEnabled();
    fireEvent.click(increase);
    expect(onChange).toHaveBeenCalledWith({ scores: { strength: 10 }, bonuses: { strength: 0 } });

    rerender(<CharacterCreationControls rules={rules} creation={{ scores: { strength: 10 }, bonuses: { strength: 0 } }} onChange={onChange} onClassChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Increase Strength base score" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease Strength base score" })).toBeEnabled();
    expect(screen.queryByRole("group", { name: "Strength bonus" })).not.toBeInTheDocument();
  });
});
