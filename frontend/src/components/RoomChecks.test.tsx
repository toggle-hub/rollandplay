import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomCheck, RoomMember } from "../api/types";
import { RoomChecks } from "./RoomChecks";

const members: RoomMember[] = [
  { id: "m-dm", room_id: "r", user_id: "dm", username: "Gwen", pronouns: "she/her", is_dm: true },
  { id: "m-a", room_id: "r", user_id: "alice", username: "Alice", pronouns: "she/her", sheet_id: "s-a", is_dm: false },
  { id: "m-b", room_id: "r", user_id: "bob", username: "Bob", pronouns: "he/him", sheet_id: "s-b", is_dm: false },
];

const rolled = (total: number) => ({ expression: "1d20+5", dice: [{ count: 1, sides: 20, values: [total - 5] }], modifier: 5, total });

function ambush(overrides: Partial<RoomCheck> = {}): RoomCheck {
  return {
    id: "c1", title: "Goblin ambush", kind: "skill", key: "stealth", label: "Stealth check", dc: 13, is_private: false,
    created_by: "dm", created_at: "now", closed_at: null,
    targets: [
      { user_id: "alice", roll: null, success: null, rolled_at: null },
      { user_id: "bob", roll: null, success: null, rolled_at: null },
    ],
    ...overrides,
  };
}

describe("RoomChecks", () => {
  afterEach(cleanup);

  it("lets a player roll only their own pending check", () => {
    const onRoll = vi.fn();
    render(<RoomChecks checks={[ambush()]} members={members} currentUserId="alice" isDM={false} onRoll={onRoll} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Goblin ambush" })).toBeInTheDocument();
    expect(screen.getByText("Stealth check · DC 13")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /for Bob/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close check" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Roll Stealth check" }));
    expect(onRoll).toHaveBeenCalledWith("c1", undefined, {});
  });

  it("lets the game master roll for a player and close the check", () => {
    const onRoll = vi.fn();
    const onClose = vi.fn();
    render(<RoomChecks checks={[ambush()]} members={members} currentUserId="dm" isDM onRoll={onRoll} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Roll Stealth check for Bob (he/him)" }));
    expect(onRoll).toHaveBeenCalledWith("c1", "bob", {});
    fireEvent.click(screen.getByRole("button", { name: "Close check" }));
    expect(onClose).toHaveBeenCalledWith("c1");
  });

  it("rolls with the advantage and bonus chosen for that check", () => {
    const onRoll = vi.fn();
    render(<RoomChecks checks={[ambush()]} members={members} currentUserId="alice" isDM={false} onRoll={onRoll} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Disadvantage" }));
    fireEvent.change(screen.getByLabelText("Bonus"), { target: { value: "-2" } });
    expect(screen.getByText("Rolls 2d20 and keeps the lower, -2 bonus")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Roll Stealth check" }));
    expect(onRoll).toHaveBeenCalledWith("c1", undefined, { mode: "disadvantage", bonus: -2 });
  });

  it("shows each outcome and who did not roll once the check is closed", () => {
    const closed = ambush({
      closed_at: "later",
      is_private: true,
      targets: [
        { user_id: "alice", roll: rolled(18), success: true, rolled_at: "later" },
        { user_id: "bob", roll: null, success: null, rolled_at: null },
      ],
    });
    render(<RoomChecks checks={[closed]} members={members} currentUserId="dm" isDM onRoll={vi.fn()} onClose={vi.fn()} />);
    const card = screen.getByRole("listitem", { name: "Goblin ambush" });
    expect(within(card).getByText("Closed")).toBeInTheDocument();
    expect(within(card).getByText("Private")).toBeInTheDocument();
    expect(within(card).getByText(/Success · 18/)).toBeInTheDocument();
    expect(within(card).getByText("Did not roll")).toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a failed roll", () => {
    const failed = ambush({ targets: [{ user_id: "alice", roll: rolled(9), success: false, rolled_at: "now" }] });
    render(<RoomChecks checks={[failed]} members={members} currentUserId="alice" isDM={false} onRoll={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Failure · 9/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
