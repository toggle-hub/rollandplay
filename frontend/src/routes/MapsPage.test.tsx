import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapsPage } from "./MapsPage";

vi.mock("../auth/SessionContext", () => ({
  useSession: () => ({ session: { status: "authenticated", user: { id: "me", username: "me", email: "me@example.com", pronouns: "", profile_complete: true } } }),
}));

const mine = { id: "m1", owner_id: "me", name: "Keep", is_public: false, width_m: 30, height_m: 30, grid_size_m: 1 };
const shared = { id: "m2", owner_id: "someone", name: "Borrowed", is_public: true, width_m: 30, height_m: 30, grid_size_m: 1 };

function stubFetch(deleteResponse: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? "GET";
    if (url === "/api/maps" && method === "GET") return { ok: true, status: 200, json: async () => [mine, shared] };
    if (url === "/api/maps/m1" && method === "DELETE") return deleteResponse;
    throw new Error(`unexpected ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("MapsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes an owned map only after confirming", async () => {
    const fetchMock = stubFetch({ ok: true, status: 204, json: async () => ({}) });
    render(<MemoryRouter><MapsPage /></MemoryRouter>);
    expect(await screen.findByText("Keep")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Borrowed" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Keep" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/maps/m1", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Delete Keep" }));
    expect(screen.getByText("Delete map?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByText("Keep")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/maps/m1", expect.objectContaining({ method: "DELETE" }));
    expect(screen.getByText("Borrowed")).toBeInTheDocument();
  });

  it("keeps the map and shows the server message when deletion is refused", async () => {
    stubFetch({ ok: false, status: 409, json: async () => ({ error: { code: "map_in_use", message: "This map is attached to a room; detach it before deleting." } }) });
    render(<MemoryRouter><MapsPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Keep" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This map is attached to a room; detach it before deleting.");
    expect(screen.getByText("Keep")).toBeInTheDocument();
  });
});
