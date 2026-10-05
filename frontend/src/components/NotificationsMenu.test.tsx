import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsMenu } from "./NotificationsMenu";

const invitation = {
  id: "inv-1",
  created_at: "now",
  room: { id: "room-1", name: "The Gilded Tankard", rule_book: { id: "book-1", name: "Tavern Rules" } },
  inviter: { id: "gm-1", username: "Greer", pronouns: "she/her" },
};

vi.mock("../auth/SessionContext", () => ({ useSession: () => ({ session: { status: "authenticated", user: { id: "me", username: "Pell", email: "p@example.com", pronouns: "", profile_complete: true } } }) }));
vi.mock("../notifications/NotificationsContext", () => ({
  useNotifications: () => ({ friend_requests: [], room_invitations: [invitation], refresh: async () => {}, announce: () => {} }),
}));

const json = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body });
const sheet = (id: string, name: string, rule_book_id = "book-1") => ({ id, name, rule_book_id, user_id: "me", data: {}, is_public: false });

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}{location.search}</output>;
}

describe("NotificationsMenu", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks which character joins when several match the room's rule book", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = input.toString();
      if (path === "/api/sheets") return json([sheet("s1", "Brannoc"), sheet("s2", "Wren"), sheet("s3", "Elsewhere", "book-2")]);
      if (path === "/api/room-invitations/inv-1/accept" && init?.method === "POST") return json({ room_id: "room-1", rule_book: { id: "book-1", name: "Tavern Rules" }, is_dm: false, sheet_id: "s2" });
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/rooms"]}><NotificationsMenu /><LocationProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 waiting" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Join room" })); });

    // Nothing is joined until a character is picked; only this book's characters are offered.
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/sheets"]);
    const picker = screen.getByLabelText("Which character joins?");
    expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Brannoc", "Wren"]);
    fireEvent.change(picker, { target: { value: "s2" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Join room" })); });

    expect(fetchMock).toHaveBeenCalledWith("/api/room-invitations/inv-1/accept", expect.objectContaining({ method: "POST", body: JSON.stringify({ sheet_id: "s2" }) }));
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/rooms/room-1");
  });
});
