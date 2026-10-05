import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomInvitePanel } from "./RoomInvitePanel";
import { ToastProvider } from "./Toast";

const petra = { id: "u-petra", username: "Petra", pronouns: "she/her" };
const json = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body });

async function flush() {
  await act(async () => {});
}

describe("RoomInvitePanel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("throttles username searches while typing and invites a match", async () => {
    vi.useFakeTimers();
    const searches: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString(), "http://test");
      if (url.pathname === "/api/rooms/r1/invitations" && init?.method === "POST")
        return json({ id: "i1", room_id: "r1", created_at: "now", invitee: petra }, 201);
      if (url.pathname === "/api/rooms/r1/invitations") return json([]);
      if (url.pathname === "/api/rooms/r1/invite-candidates") {
        searches.push(url.searchParams.get("q") ?? "");
        return json([{ ...petra, invited: false }]);
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ToastProvider><RoomInvitePanel roomId="r1" memberCount={1} /></ToastProvider>);
    await act(async () => { vi.advanceTimersByTime(1000); });

    const input = screen.getByLabelText("Username");
    fireEvent.change(input, { target: { value: "P" } });
    fireEvent.change(input, { target: { value: "Pe" } });
    await act(async () => { vi.advanceTimersByTime(100); });
    fireEvent.change(input, { target: { value: "Pet" } });
    fireEvent.change(input, { target: { value: "Petr" } });
    await act(async () => { vi.advanceTimersByTime(100); });
    // A one-letter query doesn't search; the rest of the burst collapses into its newest query.
    expect(searches).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(100); });
    await flush();
    expect(searches).toEqual(["Petr"]);

    fireEvent.click(screen.getByRole("button", { name: "Invite Petra (she/her)" }));
    await flush();
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw invitation for Petra (she/her)" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms/r1/invitations", expect.objectContaining({ method: "POST", body: JSON.stringify({ username: "Petra" }) }));
  });
});
