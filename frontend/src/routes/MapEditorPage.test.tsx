import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapEditorPage } from "./MapEditorPage";
import type { GameMap, MapStructure } from "../api/types";

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

function renderEditor() {
  render(
    <MemoryRouter initialEntries={["/maps/map-1/edit"]}>
      <Routes><Route path="/maps/:mapId/edit" element={<MapEditorPage />} /></Routes>
    </MemoryRouter>,
  );
}


describe("MapEditorPage structure controls", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps draft rotation active until Move mode is chosen, preserves shape when placing, and supports undo", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => map })));
    renderEditor();

    const geometry = await screen.findByLabelText("Geometry (JSON)");
    const canvas = screen.getByTestId("map-editor-canvas");
    fireEvent.contextMenu(canvas, screenPoint(5, 4));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rotate mode" }));
    fireEvent.pointerDown(canvas, { ...screenPoint(10, 4), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(7, 7));
    fireEvent.pointerUp(canvas);
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual([{ x: 7, y: 1 }, { x: 7, y: 7 }]);

    fireEvent.pointerDown(canvas, { ...screenPoint(7, 7), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(4, 4));
    fireEvent.pointerUp(canvas);
    const rotated = [{ x: 10, y: 4 }, { x: 4, y: 4 }];
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual(rotated);

    const empty = screenPoint(15, 12);
    fireEvent.pointerDown(canvas, { ...empty, button: 0 });
    fireEvent.pointerUp(canvas, empty);
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual(rotated);
    fireEvent.contextMenu(canvas, screenPoint(5, 4));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Move mode" }));
    fireEvent.pointerDown(canvas, { ...empty, button: 0 });
    fireEvent.pointerUp(canvas, empty);
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual([{ x: 18, y: 12 }, { x: 12, y: 12 }]);

    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual(rotated);
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(JSON.parse((geometry as HTMLTextAreaElement).value)).toEqual([{ x: 7, y: 1 }, { x: 7, y: 7 }]);
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

  it("persists repeated saved rotations through saving and undo without resetting mode", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => map }));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();
    await screen.findByLabelText("Geometry (JSON)");
    const canvas = screen.getByTestId("map-editor-canvas");
    fireEvent.contextMenu(canvas, screenPoint(5, 7));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rotate mode" }));
    fireEvent.pointerDown(canvas, { ...screenPoint(10, 7), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(7, 10));
    fireEvent.pointerUp(canvas);
    await waitFor(() => expect(screen.getByRole("button", { name: "Grow 10%" })).toBeEnabled());

    fireEvent.pointerDown(canvas, { ...screenPoint(7, 10), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(4, 7));
    fireEvent.pointerUp(canvas);
    await waitFor(() => expect(screen.getByRole("button", { name: "Grow 10%" })).toBeEnabled());
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    await screen.findByText("Last map edit undone.");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { geometry: [{ x: 7, y: 4 }, { x: 7, y: 10 }] },
      { geometry: [{ x: 10, y: 7 }, { x: 4, y: 7 }] },
      { geometry: [{ x: 7, y: 4 }, { x: 7, y: 10 }] },
    ]);
    fireEvent.contextMenu(canvas, screenPoint(7, 8));
    expect(screen.getByRole("menuitemradio", { name: "Rotate mode", checked: true })).toBeInTheDocument();
  });
});
