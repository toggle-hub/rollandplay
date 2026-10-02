import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";

describe("ChatPanel", () => {
  afterEach(cleanup);
  it("renders roll details and hides DM controls for non-DMs", () => {
    render(
      <ChatPanel
        isDM={false}
        members={[]}
        onSend={vi.fn()}
        messages={[
          {
            id: "m1",
            room_id: "r",
            sender_user_id: "u",
            kind: "roll",
            body: "",
            created_at: "now",
            roll: {
              expression: "1d20+5",
              dice: [{ count: 1, sides: 20, values: [12] }],
              modifier: 5,
              total: 17,
            },
          },
        ]}
      />,
    );
    expect(screen.getByText(/1d20\+5/)).toBeInTheDocument();
    expect(screen.getByText(/total 17/)).toBeInTheDocument();
    expect(screen.queryByText(/Private recipients/)).not.toBeInTheDocument();
  });

  it("renders the attack and damage rolls of an attack", () => {
    render(
      <ChatPanel
        isDM={false}
        members={[]}
        onSend={vi.fn()}
        messages={[
          {
            id: "m2",
            room_id: "r",
            sender_user_id: "u",
            kind: "roll",
            body: "Hero attacks Goblin with Sword",
            created_at: "now",
            roll: {
              expression: "1d20+5",
              dice: [{ count: 1, sides: 20, values: [12] }],
              modifier: 5,
              total: 17,
              damage: {
                expression: "1d8+3",
                dice: [{ count: 1, sides: 8, values: [4] }],
                modifier: 3,
                total: 7,
              },
            },
          },
        ]}
      />,
    );
    expect(screen.getByText("Attack · 1d20+5")).toBeInTheDocument();
    expect(screen.getByText("total 17")).toBeInTheDocument();
    expect(screen.getByText("Damage · 1d8+3")).toBeInTheDocument();
    expect(screen.getByText("total 7")).toBeInTheDocument();
  });

  it("marks prompted check rolls as success or failure against their DC", () => {
    const check = (success: boolean, total: number) => ({
      expression: "1d20+5",
      dice: [{ count: 1, sides: 20, values: [total - 5] }],
      modifier: 5,
      total,
      check: { check_id: "c1", title: "Goblin ambush", label: "Stealth check", dc: 13, success, user_id: "u", character_name: "Shadow" },
    });
    render(
      <ChatPanel
        isDM={false}
        members={[]}
        onSend={vi.fn()}
        messages={[
          { id: "m3", room_id: "r", sender_user_id: "u", kind: "roll", body: "Shadow: Stealth check (DC 13), success", created_at: "now", roll: check(true, 15) },
          { id: "m4", room_id: "r", sender_user_id: "u", kind: "roll", body: "Brute: Stealth check (DC 13), failure", created_at: "now", roll: check(false, 12) },
        ]}
      />,
    );
    const [success, failure] = screen.getAllByRole("article");
    expect(within(success).getByText("Goblin ambush · Stealth check · DC 13")).toBeInTheDocument();
    expect(within(success).getByText("Success")).toBeInTheDocument();
    expect(within(success).queryByText("Failure")).not.toBeInTheDocument();
    expect(within(failure).getByText("Failure")).toBeInTheDocument();
    expect(within(failure).getByText("total 12")).toBeInTheDocument();
  });
});
