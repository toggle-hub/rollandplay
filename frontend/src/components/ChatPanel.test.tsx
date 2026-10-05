import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../api/client";
import type { ChatMessage, RoomMember } from "../api/types";
import { ChatPanel } from "./ChatPanel";

vi.mock("../api/client", () => ({ apiFetch: vi.fn() }));

const member = (user_id: string, username: string, is_dm: boolean): RoomMember => ({ id: `rm-${user_id}`, room_id: "r", user_id, username, pronouns: "", sheet_id: null, is_dm });
const chat = (id: string, minute: number, body = id): ChatMessage => ({ id, room_id: "r", sender_user_id: "u", kind: "chat", body, created_at: new Date(Date.UTC(2026, 9, 5, 10, minute)).toISOString() });
const table = [member("gm", "Keeper", true), member("p1", "Ash", false), member("p2", "Birch", false)];
const bodies = () => screen.getAllByRole("article").map((article) => article.querySelector("p")?.textContent);

describe("ChatPanel", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiFetch).mockReset();
  });

  it("lets players whisper only the game master, and game masters whisper players", () => {
    const onSend = vi.fn();
    const { unmount } = render(<ChatPanel roomId="r" hasEarlier={false} isDM={false} members={table} onSend={onSend} messages={[]} />);
    expect(screen.getByText("Whisper the game master")).toBeInTheDocument();
    const choices = screen.getAllByRole("checkbox");
    expect(choices).toHaveLength(1);
    fireEvent.click(choices[0]);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "I pocket the gem" } });
    fireEvent.change(screen.getByLabelText(/Dice roll/), { target: { value: "1d20+3" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSend).toHaveBeenCalledWith("I pocket the gem", ["gm"], "1d20+3");
    unmount();

    render(<ChatPanel roomId="r" hasEarlier={false} isDM members={table} onSend={vi.fn()} messages={[]} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("Private recipients")).toBeInTheDocument();
  });

  it("loads earlier messages above the feed until none are left", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ messages: [chat("a", 1), chat("b", 2)], hasEarlier: false });
    render(<ChatPanel roomId="room-1" hasEarlier isDM={false} members={[]} onSend={vi.fn()} messages={[chat("c", 3), chat("d", 4)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => expect(bodies()).toEqual(["a", "b", "c", "d"]));
    expect(apiFetch).toHaveBeenCalledWith("/api/rooms/room-1/chat?before=c");
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).not.toBeInTheDocument();
  });

  it("keeps loaded and shown messages when the room's newest messages move on", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({ messages: [chat("a", 1)], hasEarlier: true });
    const props = { roomId: "r", isDM: false, members: [], onSend: vi.fn() };
    const { rerender } = render(<ChatPanel {...props} hasEarlier messages={[chat("b", 2), chat("c", 3)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => expect(bodies()).toEqual(["a", "b", "c"]));
    // A reload whose newest window no longer includes "b".
    rerender(<ChatPanel {...props} hasEarlier messages={[chat("c", 3), chat("d", 4)]} />);
    expect(bodies()).toEqual(["a", "b", "c", "d"]);
    expect(screen.getByRole("button", { name: "Load earlier messages" })).toBeInTheDocument();
  });

  it("shows each message's time with the full date on hover", () => {
    render(<ChatPanel roomId="r" hasEarlier={false} isDM={false} members={[]} onSend={vi.fn()} messages={[chat("a", 7)]} />);
    const time = within(screen.getByRole("article")).getByText((_, element) => element?.tagName === "TIME");
    expect(time).toHaveAttribute("datetime", "2026-10-05T10:07:00.000Z");
    expect(time.getAttribute("title")).toContain("2026");
  });
  it("renders roll details and hides DM controls for non-DMs", () => {
    render(
      <ChatPanel
        roomId="r"
        hasEarlier={false}
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
        roomId="r"
        hasEarlier={false}
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

  it("renders an action roll with each target's result and the change to its hit points", () => {
    const d20 = (value: number, modifier: number) => ({ expression: `1d20+${modifier}`, dice: [{ count: 1, sides: 20, values: [value] }], modifier, total: value + modifier });
    render(
      <ChatPanel
        roomId="r"
        hasEarlier={false}
        isDM={false}
        members={[]}
        onSend={vi.fn()}
        messages={[
          {
            id: "m5",
            room_id: "r",
            sender_user_id: "u",
            kind: "roll",
            body: "Hero attacks Goblin with Sword",
            created_at: "now",
            roll: { action: {
              name: "Sword", kind: "attack", source: "attack", source_token_id: "hero", damage_type: "slashing",
              effect: { expression: "1d8+3", dice: [{ count: 1, sides: 8, values: [4] }], modifier: 3, total: 7 },
              targets: [{ token_id: "goblin", name: "Goblin", roll: d20(12, 5), result: "hit", damage: 7, down: true }],
            } },
          },
          {
            id: "m6",
            room_id: "r",
            sender_user_id: "u",
            kind: "roll",
            body: "Hero uses Burst",
            created_at: "now",
            roll: { action: {
              name: "Burst", kind: "save", source: "action", source_token_id: "hero", dc: 13, save_ability: "dexterity", damage_type: "fire", uses_left: 0,
              effect: { expression: "2d6", dice: [{ count: 2, sides: 6, values: [1, 2] }], modifier: 0, total: 3 },
              targets: [{ token_id: "orc", name: "Orc", roll: d20(15, 1), result: "saved", damage: 1, defense: "resistant" }],
            } },
          },
        ]}
      />,
    );
    const [attack, burst] = screen.getAllByRole("article");
    expect(within(attack).getByText("Sword · slashing")).toBeInTheDocument();
    expect(within(attack).getByText("Damage · 1d8+3")).toBeInTheDocument();
    expect(within(attack).getByText("Hit")).toBeInTheDocument();
    expect(within(attack).getByText("-7")).toBeInTheDocument();
    expect(within(attack).getByText("Down")).toBeInTheDocument();
    expect(within(burst).getByText("Burst · Dexterity save DC 13 · fire")).toBeInTheDocument();
    expect(within(burst).getByText("Saved")).toBeInTheDocument();
    expect(within(burst).getByText("-1")).toBeInTheDocument();
    expect(within(burst).getByText("resistant")).toBeInTheDocument();
    expect(within(burst).getByText("0 uses left")).toBeInTheDocument();
  });

  it("says so when an area action catches no creatures", () => {
    render(
      <ChatPanel
        roomId="r"
        hasEarlier={false}
        isDM={false}
        members={[]}
        onSend={vi.fn()}
        messages={[{
          id: "m7", room_id: "r", sender_user_id: "u", kind: "roll", body: "Cleric uses Mass heal", created_at: "now",
          roll: { action: { name: "Mass heal", kind: "heal", source: "action", source_token_id: "c", effect: { expression: "1d8", dice: [{ count: 1, sides: 8, values: [5] }], modifier: 0, total: 5 }, targets: [] } },
        }]}
      />,
    );
    expect(screen.getByText("Healing · 1d8")).toBeInTheDocument();
    expect(screen.getByText("No creatures in the area")).toBeInTheDocument();
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
        roomId="r"
        hasEarlier={false}
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
