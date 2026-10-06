import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuleBook } from "../api/types";
import { RuleBooksPage } from "./RuleBooksPage";

vi.mock("../auth/SessionContext", () => ({
  useSession: () => ({ session: { status: "authenticated", user: { id: "me", username: "me", email: "me@example.com", pronouns: "", profile_complete: true } } }),
}));

const claw = { id: "claw", name: "Claw", range_m: 1.5, ability: "strength", proficient: true, attack_bonus: 0, damage: "1d6", damage_bonus: 0, damage_type: "slashing" };
const mine: RuleBook = {
  id: "b1", owner_id: "me", name: "House Rules", is_public: false, attributes: { strength: 14, proficiency_bonus: 2 },
  creation_rules: { classes: [{ id: "knight", name: "Knight", defaults: {} }] },
  monsters: [{ id: "wolf", name: "Wolf", description: "", size_m: 1.5, stats: { strength: 14, proficiency_bonus: 2, attacks: [claw] } }],
  compendium: { attacks: [], actions: [], items: [] },
};
const builtIn: RuleBook = { ...mine, id: "b0", owner_id: null, name: "D&D 5e (2014)", monsters: [], creation_rules: {} };

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
function stubFetch(replies: Record<string, (init?: RequestInit) => Reply>) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${input.toString()}`;
    if (key === "GET /api/rule-books") return { ok: true, status: 200, json: async () => [builtIn, mine] };
    const reply = replies[key];
    if (!reply) throw new Error(`unexpected ${key}`);
    return reply(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RuleBooksPage", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("edits an owned book in place, keeping its monsters' attacks and class ids", async () => {
    let sent: Record<string, unknown> = {};
    stubFetch({
      "PATCH /api/rule-books/b1": (init) => {
        sent = JSON.parse(String(init?.body));
        return { ok: true, status: 200, json: async () => ({ ...mine, ...sent }) };
      },
    });
    render(<RuleBooksPage />);
    expect(screen.queryByRole("button", { name: "Edit D&D 5e (2014)" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Edit House Rules" }));
    expect(screen.getByText(/Changes apply everywhere this book is used/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Class ID")).toBeNull();

    fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Paladin" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit Wolf's attacks & abilities" }));
    expect(screen.getByText(/To hit: \+4 \(Strength \+2, proficiency \+2\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("1d6"), { target: { value: "2d4" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to monster" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("“House Rules” saved."));
    expect(sent.name).toBe("House Rules");
    expect((sent.creation_rules as { classes: { id: string; name: string }[] }).classes[0]).toMatchObject({ id: "knight", name: "Paladin" });
    expect((sent.monsters as { stats: { attacks: { damage: string }[] } }[])[0].stats.attacks[0]).toMatchObject({ id: "claw", damage: "2d4" });
  });

  it("deletes an unused owned book and explains why a used one stays", async () => {
    let refuse = true;
    stubFetch({
      "DELETE /api/rule-books/b1": () => refuse
        ? { ok: false, status: 409, json: async () => ({ error: { code: "rule_book_in_use", message: "“House Rules” is still used by 1 room, so it can't be deleted." } }) }
        : { ok: true, status: 204, json: async () => ({}) },
    });
    render(<RuleBooksPage />);
    expect(await screen.findByRole("button", { name: "Delete House Rules" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete D&D 5e (2014)" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete House Rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("still used by 1 room");
    expect(screen.getByRole("heading", { name: "House Rules" })).toBeInTheDocument();

    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Delete House Rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "House Rules" })).toBeNull());
  });
});
