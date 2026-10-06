import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapEditorPage } from "./MapEditorPage";
import { ToastProvider } from "../components/Toast";
import type { GameMap, MapStructure } from "../api/types";
import { stampGeometry } from "../lib/structures";

vi.mock("../auth/SessionContext", () => ({
  useSession: () => ({ session: { status: "authenticated", user: { id: "user-1" } } }),
}));

const wall: MapStructure = {
  id: "wall",
  map_id: "map-1",
  kind: "wall",
  geometry: [{ x: 4, y: 7 }, { x: 10, y: 7 }],
  blocks_vision: true,
  blocks_movement: true,
  blocks_attacks: false,
  cover_bonus: 0,
  pass_rules: {},
  z_index: 1,
};
const door: MapStructure = { ...wall, id: "door", kind: "door", geometry: [{ x: 2, y: 9 }, { x: 3, y: 9 }], z_index: 2 };
const map: GameMap = {
  id: "map-1",
  owner_id: "user-1",
  name: "Arena",
  width_m: 10,
  height_m: 10,
  grid_size_m: 1,
  background_asset_id: null,
  structures: [wall],
};

const screenPoint = (x: number, y: number) => ({ clientX: 72 + x * 24 * 0.85, clientY: 72 + y * 24 * 0.85 });
/** The round rotation handle sits 28 screen pixels above the top-center of the selection frame. */
const rotateHandle = (centerX: number, top: number) => ({ ...screenPoint(centerX, top), clientY: screenPoint(centerX, top).clientY - 28 });
const anyId = expect.stringMatching(/^[0-9a-f-]{36}$/);

function drag(canvas: HTMLElement, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }) {
  fireEvent.pointerDown(canvas, { ...from, button: 0 });
  fireEvent.pointerMove(canvas, to);
  fireEvent.pointerUp(canvas, to);
}

function click(canvas: HTMLElement, point: { clientX: number; clientY: number }) {
  fireEvent.pointerDown(canvas, { ...point, button: 0 });
  fireEvent.pointerUp(canvas, point);
}

const key = (k: string, options: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => fireEvent.keyDown(window, { key: k, ...options });

function renderEditor() {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/maps/map-1/edit"]}>
        <Routes>
          <Route path="/maps/:mapId/edit" element={<MapEditorPage />} />
          <Route path="/maps" element={<p>Map list</p>} />
          <Route path="/rooms/:roomId" element={<p>Room page</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
const ok = (body: unknown, status = 200): FakeResponse => ({ ok: true, status, json: async () => body });

/** A fake map API that keeps the map, its created, patched and deleted structures, and uploads. */
function mapServer(initial: MapStructure[]) {
  let saved = initial;
  let current: GameMap = map;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<FakeResponse> => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === "/api/assets" && method === "POST") return ok({ id: "asset-1" }, 201);
    if (path === "/api/maps/map-1/rooms") return ok([{ id: "room-1", name: "Friday table", is_active: false, active_map_name: "Tavern" }]);
    if (path.startsWith("/api/rooms/") && method === "POST") return ok({ id: "rm-1", is_active: true }, 201);
    if (path === "/api/maps/map-1" && method === "PATCH") {
      current = { ...current, ...JSON.parse(String(init?.body)) };
      return ok(current);
    }
    if (method === "DELETE") {
      saved = saved.filter((structure) => !path.endsWith(`/${structure.id}`));
      return ok(undefined, 204);
    }
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      const created = { z_index: Math.max(0, ...saved.map((structure) => structure.z_index ?? 0)) + 1, ...body, map_id: "map-1" };
      saved = [...saved, created];
      return ok(created, 201);
    }
    if (method === "PATCH") {
      const fields = JSON.parse(String(init?.body));
      saved = saved.map((structure) => path.endsWith(`/${structure.id}`) ? { ...structure, ...fields } : structure);
      return ok(saved.find((structure) => path.endsWith(`/${structure.id}`)));
    }
    return ok({ ...current, structures: saved });
  });
  const bodies = (method: string, prefix = "/api/maps/map-1/structures") => fetchMock.mock.calls
    .filter(([input, init]) => init?.method === method && String(input).startsWith(prefix))
    .map(([, init]) => JSON.parse(String(init?.body)));
  const paths = (method: string) => fetchMock.mock.calls.filter(([, init]) => init?.method === method).map(([input]) => String(input));
  return { fetchMock, bodies, paths };
}

async function openEditor(structures: MapStructure[] = [wall]) {
  const server = mapServer(structures);
  vi.stubGlobal("fetch", server.fetchMock);
  renderEditor();
  await screen.findByLabelText("Geometry (JSON)");
  return { ...server, canvas: screen.getByTestId("map-editor-canvas") };
}

/** Waits until every queued save has finished. */
const idle = () => screen.findByText("Saved");
const layerCount = (count: number) => expect(screen.getByLabelText("Map summary")).toHaveTextContent(`${count} layers`);

describe("MapEditorPage structure controls", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("places the chosen brush with the Place tool, rotated by Q/E", async () => {
    const { bodies, canvas } = await openEditor();

    key("b");
    fireEvent.click(screen.getByRole("button", { name: /Door/ }));
    expect(screen.getByLabelText("Structure type")).toHaveValue("door");
    key("e");
    key("e");
    expect(screen.getByLabelText("Stamp rotation (°)")).toHaveValue(30);
    click(canvas, screenPoint(15, 12));

    layerCount(2);
    await waitFor(() => expect(bodies("POST")).toHaveLength(1));
    expect(bodies("POST")[0]).toEqual({
      id: anyId,
      kind: "door",
      geometry: stampGeometry("door", { x: 15, y: 12 }, 1, 30, 100),
      blocks_vision: true,
      blocks_movement: true,
      blocks_attacks: true,
      cover_bonus: 0,
      pass_rules: {},
      z_index: 2,
    });
    expect(screen.getByText("Tool: Place · Door")).toBeInTheDocument();
    key("Escape");
    expect(screen.getByText("Tool: Select")).toBeInTheDocument();
  });

  it("keeps every stamp of rapid clicking while the saves are still on their way", async () => {
    const server = mapServer([wall]);
    const releases: (() => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") await new Promise<void>((resolve) => releases.push(resolve));
      return server.fetchMock(input, init);
    }));
    renderEditor();
    await screen.findByLabelText("Geometry (JSON)");
    const canvas = screen.getByTestId("map-editor-canvas");

    key("b");
    for (const x of [2, 4, 6, 8, 10]) click(canvas, screenPoint(x, 2));
    layerCount(6);
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    // Saves go out one edit after another; release each as it arrives.
    for (let index = 0; index < 5; index += 1) {
      await waitFor(() => expect(releases).toHaveLength(index + 1));
      releases[index]();
    }
    await idle();
    expect(server.bodies("POST").map((body) => body.geometry[0].x)).toEqual([0, 2, 4, 6, 8]);
    layerCount(6);
  });

  it("draws a closed room with the Draw tool and saves it as one wall", async () => {
    const { bodies, canvas } = await openEditor([]);

    key("d");
    expect(screen.getByText("Tool: Draw · Wall")).toBeInTheDocument();
    click(canvas, screenPoint(1.1, 1.2));
    click(canvas, screenPoint(5.9, 0.8));
    click(canvas, screenPoint(6.2, 4.1));
    click(canvas, screenPoint(0.8, 3.9));
    key("Backspace");
    click(canvas, screenPoint(1, 4));
    click(canvas, screenPoint(1, 1));

    await idle();
    expect(bodies("POST").map((body) => body.geometry)).toEqual([[{ x: 1, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 4 }, { x: 1, y: 4 }, { x: 1, y: 1 }]]);
    expect(screen.getByTestId("map-editor-notice")).toHaveTextContent("Wall drawn.");
  });

  it("reports a refused save and drops the piece the server didn't keep", async () => {
    const server = mapServer([wall]);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: false, status: 500, json: async () => ({ error: { message: "disk full" } }) };
      return server.fetchMock(input, init);
    }));
    renderEditor();
    await screen.findByLabelText("Geometry (JSON)");

    key("b");
    click(screen.getByTestId("map-editor-canvas"), screenPoint(5, 2));
    layerCount(2);
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    await screen.findByText("Some changes weren’t saved");
    layerCount(1);
    expect(screen.getByRole("button", { name: "Undo (Ctrl+Z)" })).toBeDisabled();
  });

  it("lets stamp inputs hold partial values while typing and normalizes them on blur", async () => {
    await openEditor();
    key("b");
    const rotation = screen.getByLabelText("Stamp rotation (°)");
    const scale = screen.getByLabelText("Stamp scale (%)");

    rotation.focus();
    fireEvent.change(rotation, { target: { value: "-1" } });
    expect(rotation).toHaveValue(-1);
    fireEvent.change(rotation, { target: { value: "-15" } });
    fireEvent.blur(rotation);
    expect(rotation).toHaveValue(345);

    scale.focus();
    fireEvent.change(scale, { target: { value: "5" } });
    expect(scale).toHaveValue(5);
    fireEvent.change(scale, { target: { value: "50" } });
    fireEvent.blur(scale);
    expect(scale).toHaveValue(50);
  });

  it("adds a structure from JSON and selects it", async () => {
    const { bodies } = await openEditor();

    fireEvent.change(screen.getByLabelText("Structure type"), { target: { value: "window" } });
    fireEvent.change(screen.getByLabelText("Geometry (JSON)"), { target: { value: '[{"x":1,"y":1},{"x":2,"y":1}]' } });
    fireEvent.click(screen.getByRole("button", { name: "Add structure" }));

    await screen.findByText("Structure added.");
    await idle();
    expect(bodies("POST")).toEqual([{ id: anyId, kind: "window", geometry: [{ x: 1, y: 1 }, { x: 2, y: 1 }], blocks_vision: false, blocks_movement: true, blocks_attacks: false, cover_bonus: 0, pass_rules: {}, z_index: 2 }]);
    expect(screen.getByLabelText("Active editor state")).toHaveTextContent("1 selected");

    fireEvent.change(screen.getByLabelText("Geometry (JSON)"), { target: { value: "not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Add structure" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Geometry must be valid JSON");
    expect(bodies("POST")).toHaveLength(1);
  });

  it("imports geometry JSON into the form without creating anything", async () => {
    const { fetchMock } = await openEditor();
    const file = new File(['[{"x":2,"y":3},{"x":4,"y":3}]'], "draft.json", { type: "application/json" });

    fireEvent.change(screen.getByLabelText("Import geometry JSON"), { target: { files: [file] } });

    await waitFor(() => expect(JSON.parse((screen.getByLabelText("Geometry (JSON)") as HTMLTextAreaElement).value)).toEqual([{ x: 2, y: 3 }, { x: 4, y: 3 }]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("duplicates the selection with Ctrl+D, undoes it with Ctrl+Z and redoes it with Ctrl+Shift+Z", async () => {
    const { bodies, paths, canvas } = await openEditor();
    // With nothing selected or copied, the browser keeps its own Ctrl+D / Ctrl+C / Ctrl+V.
    expect(key("d", { ctrlKey: true })).toBe(true);
    expect(key("c", { ctrlKey: true })).toBe(true);
    expect(key("v", { ctrlKey: true })).toBe(true);
    click(canvas, screenPoint(5, 7));

    expect(key("d", { ctrlKey: true })).toBe(false);
    await screen.findByText("Duplicated 1 structures.");
    await idle();
    const copy = bodies("POST")[0];
    expect(copy).toEqual({ ...restoreFields(wall), id: anyId, geometry: [{ x: 5, y: 8 }, { x: 11, y: 8 }], z_index: 2 });
    layerCount(2);

    key("z", { ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    layerCount(1);
    await waitFor(() => expect(paths("DELETE")).toEqual([`/api/maps/map-1/structures/${copy.id}`]));

    key("z", { ctrlKey: true, shiftKey: true });
    await screen.findByText("Map edit redone.");
    layerCount(2);
    await waitFor(() => expect(bodies("POST")).toHaveLength(2));
    expect(bodies("POST")[1]).toEqual(copy);

    // The redone copy keeps its id, so undo deletes it again.
    key("z", { ctrlKey: true });
    await waitFor(() => expect(paths("DELETE")).toEqual([`/api/maps/map-1/structures/${copy.id}`, `/api/maps/map-1/structures/${copy.id}`]));
  });

  it("pastes copies offset by one more grid square each time, also from the empty-space menu", async () => {
    const { bodies, canvas } = await openEditor();
    click(canvas, screenPoint(5, 7));

    key("c", { ctrlKey: true });
    key("v", { ctrlKey: true });
    key("v", { ctrlKey: true });
    fireEvent.pointerDown(canvas, { ...screenPoint(1, 2), button: 2 });
    fireEvent.pointerUp(canvas, { ...screenPoint(1, 2), button: 2 });
    fireEvent.click(within(screen.getByRole("menu", { name: "Map actions" })).getByRole("menuitem", { name: /Paste/ }));
    await idle();
    expect(bodies("POST").map((body) => body.geometry)).toEqual([
      [{ x: 5, y: 8 }, { x: 11, y: 8 }],
      [{ x: 6, y: 9 }, { x: 12, y: 9 }],
      [{ x: 7, y: 10 }, { x: 13, y: 10 }],
    ]);
  });

  it("groups everything with Ctrl+A, Ctrl+G and ungroups with Ctrl+Shift+G", async () => {
    const { bodies } = await openEditor([wall, door]);

    key("a", { ctrlKey: true });
    expect(screen.getByLabelText("Active editor state")).toHaveTextContent("2 selected");
    key("g", { ctrlKey: true });
    await screen.findByText("Grouped 2 structures.");
    await idle();
    const [first, second] = bodies("PATCH");
    expect(first.group_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual({ group_id: first.group_id });
    expect(screen.getAllByText(/· group$/)).toHaveLength(2);

    key("g", { ctrlKey: true, shiftKey: true });
    await screen.findByText("Ungrouped 2 structures.");
    await waitFor(() => expect(bodies("PATCH").slice(2)).toEqual([{ group_id: null }, { group_id: null }]));
  });

  it("keeps undo for the structures saved when part of a multi-structure edit fails", async () => {
    const server = mapServer([wall, door]);
    // First edit: the door PATCH fails at once while the wall PATCH is still in flight.
    let firstEdit = true;
    let releaseWall: (() => void) | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH" && firstEdit) {
        if (String(input).endsWith("/door")) return { ok: false, status: 500, json: async () => ({ error: { message: "door save failed" } }) };
        await new Promise<void>((resolve) => { releaseWall = resolve; });
        firstEdit = false;
      }
      return server.fetchMock(input, init);
    }));
    renderEditor();
    await screen.findByLabelText("Geometry (JSON)");

    key("a", { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Flip vertical" }));
    await waitFor(() => expect(releaseWall).not.toBeNull());
    releaseWall!();
    expect(await screen.findByRole("alert")).toHaveTextContent("door save failed");
    await screen.findByText("Some changes weren’t saved");

    key("z", { ctrlKey: true });
    await idle();
    const patches = server.fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([input, init]) => [String(input), JSON.parse(String(init?.body))]);
    expect(patches).toEqual([
      ["/api/maps/map-1/structures/wall", { geometry: [{ x: 4, y: 9 }, { x: 10, y: 9 }] }],
      ["/api/maps/map-1/structures/wall", { geometry: wall.geometry }],
    ]);
  });

  it("flips, retypes and nudges the selection a grid square with the arrows (Shift for 0.1 m)", async () => {
    const { bodies, canvas } = await openEditor();
    click(canvas, screenPoint(5, 7));

    fireEvent.click(screen.getByRole("button", { name: "Flip horizontal" }));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "door" } });
    key("ArrowRight");
    key("ArrowRight", { shiftKey: true });
    await idle();

    expect(bodies("PATCH")).toEqual([
      { geometry: [{ x: 10, y: 7 }, { x: 4, y: 7 }] },
      { kind: "door" },
      { geometry: [{ x: 11, y: 7 }, { x: 5, y: 7 }] },
      { geometry: [{ x: 11.1, y: 7 }, { x: 5.1, y: 7 }] },
    ]);
  });

  it("saves map settings on Enter or blur and undoes them like any edit", async () => {
    const { bodies } = await openEditor();

    const width = screen.getByLabelText("Width (meters)");
    fireEvent.change(width, { target: { value: "18" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("18 × 10");
    const height = screen.getByLabelText("Height (meters)");
    fireEvent.change(height, { target: { value: "12" } });
    fireEvent.blur(height);
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("18 × 12");
    fireEvent.change(height, { target: { value: "0" } });
    fireEvent.blur(height);
    expect(height).toHaveValue(12);

    key("z", { ctrlKey: true });
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("18 × 10");
    expect(height).toHaveValue(10);
    await idle();
    expect(bodies("PATCH", "/api/maps/map-1")).toEqual([{ width_m: 18 }, { height_m: 12 }, { height_m: 10 }]);
  });

  it("uploads a background as soon as it is chosen, sizes the map to it and removes it", async () => {
    const images: { src: string; naturalWidth: number; naturalHeight: number; onload: (() => void) | null }[] = [];
    vi.stubGlobal("Image", class {
      src = "";
      naturalWidth = 2000;
      naturalHeight = 1500;
      onload: (() => void) | null = null;
      constructor() { images.push(this); }
    });
    const { bodies, fetchMock } = await openEditor();
    const file = new File(["png"], "cave.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Background image file"), { target: { files: [file] } });
    await screen.findByAltText("Current map background");
    expect(fetchMock.mock.calls.some(([input, init]) => String(input) === "/api/assets" && init?.method === "POST")).toBe(true);
    await waitFor(() => expect(images.length).toBeGreaterThan(0));
    act(() => images.forEach((image) => image.onload?.()));

    // 20 squares across a 2000 px image: 100 px per 1 m square.
    fireEvent.click(await screen.findByRole("button", { name: "Size map to 20 × 15 m" }));
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("20 × 15");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await idle();
    expect(bodies("PATCH", "/api/maps/map-1")).toEqual([{ background_asset_id: "asset-1" }, { width_m: 20, height_m: 15 }, { background_asset_id: null }]);
    expect(screen.queryByAltText("Current map background")).not.toBeInTheDocument();
  });

  it("uses the map in one of the GM's rooms and opens the room", async () => {
    const { fetchMock } = await openEditor();

    fireEvent.click(screen.getByRole("button", { name: "Use in room…" }));
    await screen.findByDisplayValue("Friday table");
    expect(screen.getByText(/Replaces “Tavern”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use map and open room" }));

    await screen.findByText("Room page");
    const attach = fetchMock.mock.calls.find(([input]) => String(input) === "/api/rooms/room-1/maps");
    expect(JSON.parse(String(attach?.[1]?.body))).toEqual({ map_id: "map-1", is_active: true });
  });

  it("names layers by type and size, and keeps locked or hidden ones out of the selection", async () => {
    const { canvas } = await openEditor([wall, door]);
    expect(screen.getByRole("button", { name: /^Door 1/ })).toHaveTextContent("1 m");
    expect(screen.getByRole("button", { name: /^Wall 1/ })).toHaveTextContent("6 m");

    fireEvent.click(screen.getByRole("button", { name: "Lock Wall 1" }));
    click(canvas, screenPoint(5, 7));
    expect(screen.getByLabelText("Active editor state")).toHaveTextContent("0 selected");
    key("a", { ctrlKey: true });
    expect(screen.getByLabelText("Active editor state")).toHaveTextContent("1 selected");

    fireEvent.click(screen.getByRole("button", { name: "Lock Wall 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Door 1" }));
    expect(screen.getByLabelText("Active editor state")).toHaveTextContent("0 selected");
    click(canvas, screenPoint(5, 7));
    expect(screen.getByLabelText("Active editor state")).toHaveTextContent("1 selected");
  });

  it("undoes the last saved canvas transform with Ctrl+Z", async () => {
    const { bodies, canvas } = await openEditor();

    drag(canvas, screenPoint(4, 7), screenPoint(5, 8));
    await idle();
    expect(bodies("PATCH")).toEqual([{ geometry: [{ x: 5, y: 8 }, { x: 11, y: 8 }] }]);

    key("z", { ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    await waitFor(() => expect(bodies("PATCH")[1]).toEqual({ geometry: wall.geometry }));
  });

  it("persists repeated handle rotations of a saved structure and undoes the last one", async () => {
    const { bodies, canvas } = await openEditor();
    click(canvas, screenPoint(5, 7));
    drag(canvas, rotateHandle(7, 7), screenPoint(10, 7));
    drag(canvas, rotateHandle(7, 4), screenPoint(10, 7));
    fireEvent.click(screen.getByRole("button", { name: "Undo (Ctrl+Z)" }));
    await screen.findByText("Last map edit undone.");
    await idle();
    expect(bodies("PATCH")).toEqual([
      { geometry: [{ x: 7, y: 4 }, { x: 7, y: 10 }] },
      { geometry: [{ x: 10, y: 7 }, { x: 4, y: 7 }] },
      { geometry: [{ x: 7, y: 4 }, { x: 7, y: 10 }] },
    ]);
  });

  it("deletes an area selection with the Delete key and restores it, draw order included, with Ctrl+Z", async () => {
    const { bodies, paths, canvas } = await openEditor([wall, door]);

    drag(canvas, screenPoint(1, 6), screenPoint(11, 10));
    expect(screen.getByRole("button", { name: "Delete selected structures" })).toBeEnabled();
    fireEvent.keyDown(canvas, { key: "Delete" });

    await screen.findByText("2 structures deleted. Press Ctrl+Z to restore them.");
    layerCount(0);
    await idle();
    expect(paths("DELETE")).toEqual(["/api/maps/map-1/structures/wall", "/api/maps/map-1/structures/door"]);

    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    layerCount(2);
    await waitFor(() => expect(bodies("POST")).toEqual([{ ...restoreFields(wall), id: "wall" }, { ...restoreFields(door), id: "door" }]));
    expect(screen.getByRole("button", { name: "Delete selected structures" })).toBeEnabled();
  });

  it("deletes the map after confirmation and reports when a room still uses it", async () => {
    let attached = true;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return attached
          ? { ok: false, status: 409, json: async () => ({ error: { code: "map_in_use", message: "This map is attached to a room; detach it before deleting." } }) }
          : { ok: true, status: 204, json: async () => undefined };
      }
      return { ok: true, status: 200, json: async () => map };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: "Delete map" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This map is attached to a room; detach it before deleting.");

    attached = false;
    fireEvent.click(screen.getByRole("button", { name: "Delete map" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("Map list");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([input]) => String(input))).toEqual(["/api/maps/map-1", "/api/maps/map-1"]);
  });
});

function restoreFields(structure: MapStructure) {
  const { kind, geometry, blocks_vision, blocks_movement, blocks_attacks, cover_bonus, pass_rules, z_index } = structure;
  return { kind, geometry, blocks_vision, blocks_movement, blocks_attacks, cover_bonus, pass_rules, z_index };
}
