import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapEditorPage } from "./MapEditorPage";
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
  structures: [wall],
};

const screenPoint = (x: number, y: number) => ({ clientX: 72 + x * 24 * 0.85, clientY: 72 + y * 24 * 0.85 });
/** The round rotation handle sits 28 screen pixels above the top-center of the selection frame. */
const rotateHandle = (centerX: number, top: number) => ({ ...screenPoint(centerX, top), clientY: screenPoint(centerX, top).clientY - 28 });

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
    <MemoryRouter initialEntries={["/maps/map-1/edit"]}>
      <Routes>
        <Route path="/maps/:mapId/edit" element={<MapEditorPage />} />
        <Route path="/maps" element={<p>Map list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A fake map API that keeps created, patched and deleted structures. */
function mapServer(initial: MapStructure[]) {
  let saved = initial;
  let nextId = 1;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "DELETE") {
      saved = saved.filter((structure) => !path.endsWith(`/${structure.id}`));
      return { ok: true, status: 204, json: async () => undefined };
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      const created = { z_index: Math.max(0, ...saved.map((structure) => structure.z_index ?? 0)) + 1, ...body, id: `created-${nextId++}`, map_id: "map-1" };
      saved = [...saved, created];
      return { ok: true, status: 201, json: async () => created };
    }
    if (init?.method === "PATCH") {
      const fields = JSON.parse(String(init.body));
      saved = saved.map((structure) => path.endsWith(`/${structure.id}`) ? { ...structure, ...fields } : structure);
      return { ok: true, status: 200, json: async () => saved.find((structure) => path.endsWith(`/${structure.id}`)) };
    }
    return { ok: true, status: 200, json: async () => ({ ...map, structures: saved }) };
  });
  const bodies = (method: string) => fetchMock.mock.calls.filter(([, init]) => init?.method === method).map(([, init]) => JSON.parse(String(init?.body)));
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

/** Waits until the last edit finished saving (Undo re-enables once the editor is no longer busy). */
const idle = () => waitFor(() => expect(screen.getByRole("button", { name: "Undo (Ctrl+Z)" })).toBeEnabled());

describe("MapEditorPage structure controls", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
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

    await waitFor(() => expect(bodies("POST")).toHaveLength(1));
    expect(bodies("POST")[0]).toEqual({
      kind: "door",
      geometry: stampGeometry("door", { x: 15, y: 12 }, 1, 30, 100),
      blocks_vision: true,
      blocks_movement: true,
      blocks_attacks: true,
      cover_bonus: 0,
      pass_rules: {},
    });
    await waitFor(() => expect(screen.getByLabelText("Map summary")).toHaveTextContent("2 layers"));
    expect(screen.getByText("Tool: Place · Door")).toBeInTheDocument();
    key("Escape");
    expect(screen.getByText("Tool: Select")).toBeInTheDocument();
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
    expect(bodies("POST")).toEqual([{ kind: "window", geometry: [{ x: 1, y: 1 }, { x: 2, y: 1 }], blocks_vision: false, blocks_movement: true, blocks_attacks: false, cover_bonus: 0, pass_rules: {} }]);
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
    expect(bodies("POST")).toEqual([{ ...restoreFields(wall), geometry: [{ x: 5, y: 8 }, { x: 11, y: 8 }], z_index: 2 }]);
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("2 layers");

    key("z", { ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    expect(paths("DELETE")).toEqual(["/api/maps/map-1/structures/created-1"]);
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("1 layers");

    key("z", { ctrlKey: true, shiftKey: true });
    await screen.findByText("Map edit redone.");
    expect(bodies("POST")[1]).toEqual(bodies("POST")[0]);
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("2 layers");

    // The redone copy has a new id; undo must delete that one.
    key("z", { ctrlKey: true });
    await waitFor(() => expect(paths("DELETE")).toEqual(["/api/maps/map-1/structures/created-1", "/api/maps/map-1/structures/created-2"]));
  });

  it("pastes copies offset by one more grid square each time", async () => {
    const { bodies, canvas } = await openEditor();
    click(canvas, screenPoint(5, 7));

    key("c", { ctrlKey: true });
    key("v", { ctrlKey: true });
    await screen.findByText("Pasted 1 structures.");
    key("v", { ctrlKey: true });
    await waitFor(() => expect(bodies("POST")).toHaveLength(2));
    expect(bodies("POST").map((body) => body.geometry)).toEqual([
      [{ x: 5, y: 8 }, { x: 11, y: 8 }],
      [{ x: 6, y: 9 }, { x: 12, y: 9 }],
    ]);
  });

  it("groups everything with Ctrl+A, Ctrl+G and ungroups with Ctrl+Shift+G", async () => {
    const { bodies } = await openEditor([wall, door]);

    key("a", { ctrlKey: true });
    expect(screen.getByLabelText("Active editor state")).toHaveTextContent("2 selected");
    key("g", { ctrlKey: true });
    await screen.findByText("Grouped 2 structures.");
    const [first, second] = bodies("PATCH");
    expect(first.group_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual({ group_id: first.group_id });
    expect(screen.getAllByText(/· group$/)).toHaveLength(2);

    key("g", { ctrlKey: true, shiftKey: true });
    await screen.findByText("Ungrouped 2 structures.");
    expect(bodies("PATCH").slice(2)).toEqual([{ group_id: null }, { group_id: null }]);
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
    await idle();

    key("z", { ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    const patches = server.fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([input, init]) => [String(input), JSON.parse(String(init?.body))]);
    expect(patches).toEqual([
      ["/api/maps/map-1/structures/wall", { geometry: [{ x: 4, y: 9 }, { x: 10, y: 9 }] }],
      ["/api/maps/map-1/structures/wall", { geometry: wall.geometry }],
    ]);
  });

  it("flips, retypes and nudges the selection from the panel and arrow keys", async () => {
    const { bodies, canvas } = await openEditor();
    click(canvas, screenPoint(5, 7));

    fireEvent.click(screen.getByRole("button", { name: "Flip horizontal" }));
    await idle();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "door" } });
    await idle();
    key("ArrowRight");
    await idle();
    key("ArrowRight", { shiftKey: true });
    await waitFor(() => expect(bodies("PATCH")).toHaveLength(4));

    expect(bodies("PATCH")).toEqual([
      { geometry: [{ x: 10, y: 7 }, { x: 4, y: 7 }] },
      { kind: "door" },
      { geometry: [{ x: 10.1, y: 7 }, { x: 4.1, y: 7 }] },
      { geometry: [{ x: 11.1, y: 7 }, { x: 5.1, y: 7 }] },
    ]);
  });

  it("resizes the playable map width and height from map settings", async () => {
    let currentMap = map;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        currentMap = { ...currentMap, ...JSON.parse(String(init.body)) };
      }
      return { ok: true, status: 200, json: async () => currentMap };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    const width = await screen.findByLabelText("Width (meters)");
    const height = screen.getByLabelText("Height (meters)");
    fireEvent.change(width, { target: { value: "18" } });
    fireEvent.blur(width);

    await waitFor(() => expect(screen.getByLabelText("Map summary")).toHaveTextContent("18 × 10"));
    await waitFor(() => expect(height).toBeEnabled());
    fireEvent.change(height, { target: { value: "12" } });
    fireEvent.blur(height);

    await waitFor(() => expect(screen.getByLabelText("Map summary")).toHaveTextContent("18 × 12"));
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { width_m: 18 },
      { height_m: 12 },
    ]);
  });

  it("undoes the last saved canvas transform with Ctrl+Z", async () => {
    const { bodies, canvas } = await openEditor();

    drag(canvas, screenPoint(4, 7), screenPoint(5, 8));
    await idle();
    expect(bodies("PATCH")).toEqual([{ geometry: [{ x: 5, y: 8 }, { x: 11, y: 8 }] }]);

    key("z", { ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    expect(bodies("PATCH")[1]).toEqual({ geometry: wall.geometry });
  });

  it("persists repeated handle rotations of a saved structure and undoes the last one", async () => {
    const { bodies, canvas } = await openEditor();
    click(canvas, screenPoint(5, 7));
    drag(canvas, rotateHandle(7, 7), screenPoint(10, 7));
    await idle();

    drag(canvas, rotateHandle(7, 4), screenPoint(10, 7));
    await idle();
    fireEvent.click(screen.getByRole("button", { name: "Undo (Ctrl+Z)" }));
    await screen.findByText("Last map edit undone.");
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

    await screen.findByText("2 structures deleted. Press Ctrl/Cmd+Z to restore them.");
    expect(paths("DELETE")).toEqual(["/api/maps/map-1/structures/wall", "/api/maps/map-1/structures/door"]);
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("0 layers");

    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    expect(bodies("POST")).toEqual([restoreFields(wall), restoreFields(door)]);
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("2 layers");
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
