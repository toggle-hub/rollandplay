import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapEditorPage } from "./MapEditorPage";
import type { GameMap, MapStructure } from "../api/types";

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
};
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


describe("MapEditorPage structure controls", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("rotates the draft with its round handle, keeps the shape when placing it, and undoes both", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => map })));
    renderEditor();

    const geometry = await screen.findByLabelText("Geometry (JSON)");
    const canvas = screen.getByTestId("map-editor-canvas");
    const rotated = [{ x: 7, y: 1 }, { x: 7, y: 7 }];
    drag(canvas, rotateHandle(7, 4), screenPoint(10, 4));
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual(rotated);

    click(canvas, screenPoint(15, 12));
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual([{ x: 15, y: 9 }, { x: 15, y: 15 }]);

    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual(rotated);
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual([{ x: 4, y: 4 }, { x: 10, y: 4 }]);
  });

  it("places the draft from the canvas palette without scrolling to the form", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => map,
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    const placeButton = await screen.findByRole("button", { name: "Place Wall" });

    fireEvent.click(placeButton);

    await screen.findByText("Structure added.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/maps/map-1/structures");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      kind: "wall",
      geometry: [{ x: 4, y: 4 }, { x: 10, y: 4 }],
      blocks_vision: true,
      blocks_movement: true,
      blocks_attacks: true,
      cover_bonus: 0,
      pass_rules: {},
    });
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

  it("keeps the right palette synced with the structure form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => map })));
    renderEditor();

    await screen.findByLabelText("Geometry (JSON)");
    fireEvent.click(screen.getByRole("button", { name: /Door/ }));

    expect(screen.getByLabelText("Structure type")).toHaveValue("door");
    expect(screen.getByRole("button", { name: /Door/, pressed: true })).toBeInTheDocument();
  });

  it("keeps the selected palette type while editing draft geometry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => map })));
    renderEditor();

    const geometry = await screen.findByLabelText("Geometry (JSON)");
    fireEvent.click(screen.getByRole("button", { name: /Window/ }));

    expect(screen.getByLabelText("Line of sight")).not.toBeChecked();
    expect(screen.getByLabelText("Movement")).toBeChecked();
    expect(screen.getByLabelText("Attacks")).not.toBeChecked();
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual([{ x: 6.5, y: 4 }, { x: 7.5, y: 4 }]);
    fireEvent.change(geometry, { target: { value: '[{"x":1,"y":1},{"x":2,"y":1}]' } });

    expect(screen.getByLabelText("Structure type")).toHaveValue("window");
    expect(screen.getByRole("button", { name: /Window/, pressed: true })).toBeInTheDocument();
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  });

  it("imports draft geometry JSON without removing the manual JSON editor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => map })));
    renderEditor();

    const geometry = await screen.findByLabelText("Geometry (JSON)");
    const importInput = screen.getByLabelText("Import draft geometry JSON");
    const file = new File(['[{"x":2,"y":3},{"x":4,"y":3}]'], "draft.json", { type: "application/json" });

    fireEvent.change(importInput, { target: { files: [file] } });

    await waitFor(() => expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual([{ x: 2, y: 3 }, { x: 4, y: 3 }]));
  });

  it("undoes the last saved canvas transform with Ctrl+Z", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => map }));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    await screen.findByLabelText("Geometry (JSON)");
    const canvas = screen.getByTestId("map-editor-canvas");
    const from = { clientX: 72 + 4 * 24 * 0.85, clientY: 72 + 7 * 24 * 0.85 };
    const to = { clientX: 72 + 5 * 24 * 0.85, clientY: 72 + 8 * 24 * 0.85 };
    fireEvent.pointerDown(canvas, { ...from, button: 0 });
    fireEvent.pointerMove(canvas, to);
    fireEvent.pointerUp(canvas, to);

    await waitFor(() => expect(screen.getByRole("button", { name: "Grow 10%" })).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      geometry: [{ x: 5, y: 8 }, { x: 11, y: 8 }],
    });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    await screen.findByText("Last map edit undone.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      geometry: wall.geometry,
    });
  });

  it("persists repeated handle rotations of a saved structure and undoes the last one", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => map }));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();
    await screen.findByLabelText("Geometry (JSON)");
    const canvas = screen.getByTestId("map-editor-canvas");
    click(canvas, screenPoint(5, 7));
    drag(canvas, rotateHandle(7, 7), screenPoint(10, 7));
    await waitFor(() => expect(screen.getByRole("button", { name: "Grow 10%" })).toBeEnabled());

    drag(canvas, rotateHandle(7, 4), screenPoint(10, 7));
    await waitFor(() => expect(screen.getByRole("button", { name: "Grow 10%" })).toBeEnabled());
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { geometry: [{ x: 7, y: 4 }, { x: 7, y: 10 }] },
      { geometry: [{ x: 10, y: 7 }, { x: 4, y: 7 }] },
      { geometry: [{ x: 7, y: 4 }, { x: 7, y: 10 }] },
    ]);
  });

  it("deletes an area selection with the Delete key and restores it with Ctrl+Z", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const door: MapStructure = { ...wall, id: "door", kind: "door", geometry: [{ x: 2, y: 9 }, { x: 3, y: 9 }] };
    let saved: MapStructure[] = [wall, door];
    let nextId = 1;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "DELETE") {
        saved = saved.filter((structure) => !path.endsWith(`/${structure.id}`));
        return { ok: true, status: 204, json: async () => undefined };
      }
      if (init?.method === "POST") {
        const created = { ...JSON.parse(String(init.body)), id: `restored-${nextId++}`, map_id: "map-1" };
        saved = [...saved, created];
        return { ok: true, status: 201, json: async () => created };
      }
      return { ok: true, status: 200, json: async () => ({ ...map, structures: saved }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();
    await screen.findByLabelText("Geometry (JSON)");
    const canvas = screen.getByTestId("map-editor-canvas");

    drag(canvas, screenPoint(1, 6), screenPoint(11, 10));
    expect(screen.getByRole("button", { name: "Delete selected structures" })).toBeEnabled();
    fireEvent.keyDown(canvas, { key: "Delete" });

    await screen.findByText("2 structures deleted. Press Ctrl/Cmd+Z to restore them.");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([input]) => String(input))).toEqual([
      "/api/maps/map-1/structures/wall",
      "/api/maps/map-1/structures/door",
    ]);
    expect(screen.getByLabelText("Map summary")).toHaveTextContent("0 layers");
    expect(screen.getByRole("button", { name: "Delete selected structures" })).toBeDisabled();

    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { kind: "wall", geometry: wall.geometry, blocks_vision: true, blocks_movement: true, blocks_attacks: false, cover_bonus: 0, pass_rules: {} },
      { kind: "door", geometry: door.geometry, blocks_vision: true, blocks_movement: true, blocks_attacks: false, cover_bonus: 0, pass_rules: {} },
    ]);
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
