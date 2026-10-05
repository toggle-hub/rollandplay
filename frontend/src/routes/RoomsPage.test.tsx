import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/Toast";
import { RoomsPage } from "./RoomsPage";

vi.mock("../auth/SessionContext", () => ({ useSession: () => ({ session: { status: "authenticated", user: { id: "me", username: "Pell", email: "p@example.com", pronouns: "", profile_complete: true } } }) }));

const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
const book = { id: "book-1", name: "Tavern Rules" };
const room = (id: string, name: string, owner: string, membership: object) => ({ id, name, owner_id: owner, is_public: false, invite_code: `CODE-${id}`, settings: {}, rule_book: book, requires_password: false, membership, player_count: 2 });

function openRooms(rooms: unknown[], extra: (path: string, init?: RequestInit) => unknown = () => undefined) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = input.toString();
    const handled = extra(path, init);
    if (handled) return handled;
    if (path === "/api/rooms" && !init?.method) return json(rooms);
    if (path === "/api/rule-books") return json([book]);
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter><ToastProvider><RoomsPage /></ToastProvider></MemoryRouter>);
  return fetchMock;
}

describe("RoomsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("creates private rooms by default, with the optional password", async () => {
    const fetchMock = openRooms([], (path, init) => path === "/api/rooms" && init?.method === "POST" ? json({ ...room("new", "Den", "me", { is_dm: true }) }, 201) : undefined);
    expect(await screen.findByRole("option", { name: "Tavern Rules" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Private \(invite only\)/ })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Den" } });
    fireEvent.change(screen.getByLabelText("Password (optional)"), { target: { value: "hunter2" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create room" })); });
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Den", is_public: false, password: "hunter2", rule_book_id: "book-1" }) }));
  });

  it("shows each seat and lets a player leave after confirming", async () => {
    const fetchMock = openRooms([
      room("r1", "My Table", "me", { is_dm: true, sheet_id: null, sheet_name: null }),
      room("r2", "Their Table", "gm", { is_dm: false, sheet_id: "s1", sheet_name: "Wren" }),
    ], (path, init) => path === "/api/rooms/r2/leave" && init?.method === "POST" ? json(undefined, 204) : undefined);
    const list = await screen.findByRole("list", { name: "Your rooms" });
    const [mine, theirs] = within(list).getAllByRole("listitem");
    expect(mine).toHaveTextContent("Game master");
    expect(mine).toHaveTextContent("2 players");
    expect(within(mine).getByRole("button", { name: "Delete My Table" })).toBeInTheDocument();
    expect(theirs).toHaveTextContent("Playing as Wren");

    fireEvent.click(within(theirs).getByRole("button", { name: "Leave Their Table" }));
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/rooms/r2/leave")).toBe(false);
    await act(async () => { fireEvent.click(within(theirs).getByRole("button", { name: "Leave room" })); });
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms/r2/leave", expect.objectContaining({ method: "POST" }));
    expect(screen.queryByText("Their Table")).not.toBeInTheDocument();
    expect(screen.getByText("My Table")).toBeInTheDocument();
  });

  it("looks up an invite link's code right away", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = input.toString();
      if (path === "/api/invites/TAVERN42") return json({ room_id: "r9", name: "The Gilded Tankard", rule_book: book, requires_password: true, member: null });
      if (path === "/api/rule-books") return json([book]);
      return json([]);
    }));
    render(<MemoryRouter initialEntries={[{ pathname: "/rooms", state: { invite: "TAVERN42" } }]}><ToastProvider><RoomsPage /></ToastProvider></MemoryRouter>);
    expect(await screen.findByRole("region", { name: "Invite details" })).toHaveTextContent("The Gilded Tankard");
    expect(screen.getByLabelText("Invite code")).toHaveValue("TAVERN42");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });
});
