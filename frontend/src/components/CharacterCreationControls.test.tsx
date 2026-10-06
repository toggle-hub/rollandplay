import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreationRules } from "../api/types";
import { PointBuyControls } from "./CharacterCreationControls";

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
const noError = () => undefined;

describe("PointBuyControls", () => {
  afterEach(cleanup);

  it("steps base scores within the point budget", () => {
    const onChange = vi.fn();
    const { rerender } = render(<PointBuyControls rules={rules} creation={{ scores: { strength: 9 }, bonuses: { strength: 0 } }} errorFor={noError} onChange={onChange} />);
    const increase = screen.getByRole("button", { name: "Increase Strength base score" });
    expect(increase).toBeEnabled();
    fireEvent.click(increase);
    expect(onChange).toHaveBeenCalledWith({ scores: { strength: 10 }, bonuses: { strength: 0 } });

    rerender(<PointBuyControls rules={rules} creation={{ scores: { strength: 10 }, bonuses: { strength: 0 } }} errorFor={noError} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Increase Strength base score" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease Strength base score" })).toBeEnabled();
    expect(screen.queryByRole("group", { name: "Strength bonus" })).not.toBeInTheDocument();
  });

  it("shows the modifier of the final score, bonus included", () => {
    const withBonus: CreationRules = { point_buy: { ...rules.point_buy!, budget: 27, bonus_budget: 3, bonus_max: 2 } };
    render(<PointBuyControls rules={withBonus} creation={{ scores: { strength: 15 }, bonuses: { strength: 2 } }} errorFor={noError} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Strength final score")).toHaveTextContent("17");
    expect(screen.getByLabelText("Strength modifier")).toHaveTextContent("+3");
    expect(screen.getByRole("button", { name: "Increase Strength bonus" })).toBeDisabled();
  });
});
