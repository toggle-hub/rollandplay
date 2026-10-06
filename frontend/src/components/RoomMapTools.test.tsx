import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameMap, RoomMapSummary, VisibleRoomState } from "../api/types";
import { RoomMapCard } from "./RoomMapTools";
import { ToastProvider } from "./Toast";

const json = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body });
const maps: GameMap[] = [
  { id: "m-cave", name: "Cave", width_m: 20, height_m: 20, grid_size_m: 1.5 },
  { id: "m-keep", name: "Keep", width_m: 30, height_m: 30, grid_size_m: 1.5 },
];
const state = {
  room: { id: "r1", name: "Table", invite_code: "ABC", rule_book: { id: "b", name: "Rules" } },
  activeMap: { id: "rm-cave", map_id: "m-cave", name: "Cave", width_m: 20, height_m: 20, grid_size_m: 1.5 },
  structures: [], visibleTokens: [], ownTokens: [], chatHistory: [], metersPerGrid: 1.5,
} as unknown as VisibleRoomState;
const summaries = (changes = { added: 0, moved: 0, removed: 0 }): RoomMapSummary[] => [
  { id: "rm-cave", map_id: "m-cave", name: "Cave", is_active: true, token_count: 3, can_edit: true, table_changes: changes },
  { id: "rm-keep", map_id: "m-keep", name: "Keep", is_active: false, token_count: 1, can_edit: true, table_changes: { added: 0, moved: 0, removed: 0 } },
];

function renderCard(rows: RoomMapSummary[], mapChoice = "m-cave") {
  const posts: { path: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(input.toString(), "http://test").pathname;
    if (init?.method === "POST") {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return json({ added: 2, moved: 1, removed: 0 });
    }
    if (path === "/api/rooms/r1/maps") return json(rows);
    throw new Error(`unexpected ${path}`);
  }));
  const run = vi.fn(async (action: () => Promise<unknown>) => { await action(); });
  render(<MemoryRouter><ToastProvider>
    <RoomMapCard roomId="r1" state={state} maps={maps} mapChoice={mapChoice} onMapChoice={vi.fn()} busy={false} run={run} />
  </ToastProvider></MemoryRouter>);
  return posts;
}

describe("RoomMapCard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists how many tokens wait on each map and asks before switching", async () => {
    const posts = renderCard(summaries(), "m-keep");
    await act(async () => {});
    expect(screen.getByRole("option", { name: "Cave (active) · 3 tokens" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Keep · 1 token" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set active map" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Switch to Keep? The 3 tokens on Cave will be set aside until you switch back. Keep has 1 token waiting.");
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Keep current map" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(posts).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Set active map" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch map" })); });
    expect(posts).toEqual([{ path: "/api/rooms/r1/maps", body: { map_id: "m-keep", is_active: true } }]);
  });

  it("saves the table's structure changes into the map after a confirm", async () => {
    const posts = renderCard(summaries({ added: 2, moved: 1, removed: 0 }));
    await act(async () => {});
    expect(screen.getByRole("link", { name: "Open in map editor" })).toHaveAttribute("href", "/maps/m-cave/edit");
    expect(screen.getByText("2 added · 1 moved at this table")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save table changes to map" }));
    expect(posts).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save to map" })); });
    expect(posts).toEqual([{ path: "/api/rooms/r1/maps/rm-cave/save", body: {} }]);
  });

  it("offers no save when nothing changed at the table", async () => {
    renderCard(summaries());
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Save table changes to map" })).toBeDisabled();
  });
});
