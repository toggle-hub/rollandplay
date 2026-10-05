import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FriendsPage } from "./FriendsPage";

const inbound = {
  id: "f1",
  requester_user_id: "u1",
  addressee_user_id: "u2",
  status: "pending",
  other_user: { id: "u1", username: "a", email: "a@example.com", pronouns: "she/her", profile_complete: true },
  direction: "inbound",
};
describe("FriendsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("renders buckets and accepts inbound without page reload", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? "GET";
        if (url === "/api/friends" && method === "GET")
          return {
            ok: true,
            status: 200,
            json: async () => ({
              pending_inbound: [inbound],
              pending_outbound: [
                {
                  ...inbound,
                  id: "f2",
                  other_user: {
                    id: "u3",
                    username: "c",
                    email: "c@example.com",
                    pronouns: "they/them",
                    profile_complete: true,
                  },
                },
              ],
              accepted: [
                {
                  ...inbound,
                  id: "f3",
                  status: "accepted",
                  other_user: {
                    id: "u4",
                    username: "d",
                    email: "d@example.com",
                    pronouns: "he/him",
                    profile_complete: true,
                  },
                },
              ],
              blocked: [],
            }),
          };
        if (url === "/api/friends/f1" && method === "PATCH")
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: "f1", status: "accepted" }),
          };
        return { ok: true, status: 204, json: async () => ({}) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<FriendsPage />);
    expect(await screen.findByText("a (she/her)")).toBeInTheDocument();
    expect(screen.getByText("d (he/him)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument(),
    );
    const accepted = screen.getByRole("heading", { name: "Your friends" }).closest("section")!;
    const incoming = screen.getByRole("heading", { name: "Incoming requests" }).closest("section")!;
    expect(within(accepted).getByText("a (she/her)")).toBeInTheDocument();
    expect(within(incoming).queryByText("a (she/her)")).not.toBeInTheDocument();
  });

  it("sends a friend request by username, or by email when an @ is typed", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === "/api/friends" && (init?.method ?? "GET") === "GET")
        return { ok: true, status: 200, json: async () => ({ pending_inbound: [], pending_outbound: [], accepted: [], blocked: [] }) };
      return { ok: true, status: 201, json: async () => ({ id: "f9", status: "pending" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<FriendsPage />);
    const field = await screen.findByLabelText("Their username or email");
    fireEvent.change(field, { target: { value: " Petra " } });
    fireEvent.click(screen.getByRole("button", { name: "Request friend" }));
    expect(await screen.findByText("Friend request sent.")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "petra@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Request friend" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/friends", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "petra@example.com" }) })));
    expect(fetchMock).toHaveBeenCalledWith("/api/friends", expect.objectContaining({ method: "POST", body: JSON.stringify({ username: "Petra" }) }));
  });
});
