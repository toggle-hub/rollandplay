import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapEditorCanvas } from "./MapEditorCanvas";
import type { GameMap, MapStructure } from "../api/types";

const map: GameMap = {
  id: "map",
  name: "Arena",
  width_m: 10,
  height_m: 10,
  grid_size_m: 1,
};
const wall: MapStructure = {
  id: "wall",
  map_id: "map",
  kind: "wall",
  geometry: [{ x: 4, y: 4 }, { x: 10, y: 4 }],
  blocks_vision: true,
  blocks_movement: true,
  blocks_attacks: false,
  cover_bonus: 2,
  pass_rules: { movement: true },
};

const screenPoint = (x: number, y: number, camera = { x: 72, y: 72 }) => ({ clientX: camera.x + x * 24 * 0.85, clientY: camera.y + y * 24 * 0.85 });

function SavedEditor() {
  const [structures, setStructures] = useState([wall, { ...wall, id: "other", geometry: [{ x: 12, y: 10 }, { x: 18, y: 10 }] }]);
  const [selected, setSelected] = useState(wall.id);
  return <>
    <MapEditorCanvas
      map={map}
      structures={structures}
      selectedStructureId={selected}
      draftStructure={wall}
      onSelectStructure={setSelected}
      onTransformStructure={(id, geometry) => setStructures((current) => current.map((structure) => structure.id === id ? { ...structure, geometry } : structure))}
    />
    <output data-testid="saved-geometry">{JSON.stringify(structures.map((structure) => structure.geometry))}</output>
  </>;
}

describe("MapEditorCanvas", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    globalThis.__canvasContext.setLineDash.mockClear();
  });
  afterEach(cleanup);

  it("shows structure attributes on hover", () => {
    render(<MapEditorCanvas map={map} structures={[wall]} />);
    fireEvent.pointerMove(screen.getByTestId("map-editor-canvas"), screenPoint(5, 4));

    expect(screen.getByText("wall")).toBeInTheDocument();
    expect(screen.getByText("Vision")).toBeInTheDocument();
    expect(screen.getAllByText("blocks")).toHaveLength(2);
    expect(screen.getByText("Cover")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(2);
    expect(screen.getByText("Pass rules: movement")).toBeInTheDocument();
  });

  it("moves a clicked structure in map coordinates", () => {
    const transform = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} onTransformStructure={transform} />);
    const canvas = screen.getByTestId("map-editor-canvas");

    fireEvent.pointerDown(canvas, { ...screenPoint(4, 4), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(5, 6));
    fireEvent.pointerUp(canvas);

    expect(transform).toHaveBeenCalledWith("wall", [{ x: 5, y: 6 }, { x: 11, y: 6 }], "move");
  });


  it("zooms in and out around the pointer only while Control is held", () => {
    render(<MapEditorCanvas map={map} structures={[wall]} />);
    const canvas = screen.getByTestId("map-editor-canvas");
    const pointer = screenPoint(5, 4);

    fireEvent.wheel(canvas, { ...pointer, deltaY: -100 });
    expect(screen.getByText("85%")).toBeInTheDocument();

    fireEvent.wheel(canvas, { ...pointer, deltaY: -100, ctrlKey: true });
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.pointerMove(canvas, pointer);
    expect(screen.getByText("wall")).toBeInTheDocument();

    fireEvent.wheel(canvas, { ...pointer, deltaY: 100, ctrlKey: true });
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("resizes a selection from a corner handle while keeping the opposite corner fixed", () => {
    const transform = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} selectedStructureId="wall" onTransformStructure={transform} />);
    const canvas = screen.getByTestId("map-editor-canvas");

    fireEvent.pointerDown(canvas, { ...screenPoint(10, 4), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(13, 4));
    fireEvent.pointerUp(canvas);

    expect(transform).toHaveBeenCalledWith("wall", [{ x: 4, y: 4 }, { x: 13, y: 4 }], "resize");
  });

  it("keeps Rotate mode across repeated drags and selection changes, until Move mode is chosen", () => {
    render(<SavedEditor />);
    const canvas = screen.getByTestId("map-editor-canvas");
    const savedGeometry = () => JSON.parse(screen.getByTestId("saved-geometry").textContent!);
    fireEvent.contextMenu(canvas, screenPoint(5, 4));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rotate mode" }));

    // The selected saved wall wins over the overlapping draft, including at its endpoint.
    fireEvent.pointerDown(canvas, { ...screenPoint(10, 4), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(7, 7));
    fireEvent.pointerUp(canvas);
    expect(savedGeometry()[0]).toEqual([{ x: 7, y: 1 }, { x: 7, y: 7 }]);

    fireEvent.pointerDown(canvas, { ...screenPoint(7, 7), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(4, 4));
    fireEvent.pointerUp(canvas);
    expect(savedGeometry()[0]).toEqual([{ x: 10, y: 4 }, { x: 4, y: 4 }]);

    fireEvent.pointerDown(canvas, { ...screenPoint(18, 10), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(15, 13));
    fireEvent.pointerUp(canvas);
    expect(savedGeometry()[1]).toEqual([{ x: 15, y: 7 }, { x: 15, y: 13 }]);

    fireEvent.contextMenu(canvas, screenPoint(15, 11));
    expect(screen.getByRole("menuitemradio", { name: "Rotate mode", checked: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Move mode" }));
    fireEvent.pointerDown(canvas, { ...screenPoint(15, 10), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(16, 12));
    fireEvent.pointerUp(canvas);
    expect(savedGeometry()[1]).toEqual([{ x: 16, y: 9 }, { x: 16, y: 15 }]);
  });

  it("snaps center rotation to 15 degrees when Shift is held", () => {
    const transform = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} selectedStructureId="wall" onTransformStructure={transform} />);
    const canvas = screen.getByTestId("map-editor-canvas");
    fireEvent.contextMenu(canvas, screenPoint(5, 4));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rotate mode" }));
    fireEvent.pointerDown(canvas, { ...screenPoint(10, 4), button: 0 });
    fireEvent.pointerMove(canvas, { ...screenPoint(10, 5), shiftKey: true });
    fireEvent.pointerUp(canvas);
    expect(transform).toHaveBeenCalledWith("wall", [{ x: 4.1, y: 3.22 }, { x: 9.9, y: 4.78 }], "rotate");
  });

  it("keeps draft rotation after cancellation, empty clicks, and wheel dismissal", () => {
    const transform = vi.fn();
    const end = vi.fn();
    const moveDraft = vi.fn();
    render(<MapEditorCanvas map={map} structures={[]} draftStructure={wall} onTransformDraft={transform} onTransformDraftEnd={end} onMoveDraft={moveDraft} />);
    const canvas = screen.getByTestId("map-editor-canvas");
    fireEvent.contextMenu(canvas, screenPoint(5, 4));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rotate mode" }));

    for (const cancellation of ["Escape", "pointercancel"]) {
      fireEvent.pointerDown(canvas, { ...screenPoint(10, 4), button: 0 });
      fireEvent.pointerMove(canvas, screenPoint(7, 7));
      if (cancellation === "Escape") fireEvent.keyDown(canvas, { key: "Escape" });
      else fireEvent.pointerCancel(canvas);
      fireEvent.pointerUp(canvas);
      expect(transform).toHaveBeenLastCalledWith(wall.geometry, "rotate");
      expect(end).not.toHaveBeenCalled();
    }

    fireEvent.pointerDown(canvas, { ...screenPoint(1, 1), button: 0 });
    fireEvent.pointerUp(canvas, screenPoint(1, 1));
    expect(moveDraft).not.toHaveBeenCalled();
    fireEvent.contextMenu(canvas, screenPoint(5, 4));
    fireEvent.keyDown(screen.getByRole("menuitemradio", { name: "Rotate mode" }), { key: "Escape" });
    fireEvent.pointerDown(canvas, { ...screenPoint(10, 4), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(7, 7));
    fireEvent.pointerUp(canvas);
    expect(end).toHaveBeenCalledWith(wall.geometry, [{ x: 7, y: 1 }, { x: 7, y: 7 }], "rotate");
  });

  it("cancels a transform when disabled without resetting the selected mode", () => {
    const transform = vi.fn();
    const props = { map, structures: [wall], selectedStructureId: "wall", onTransformStructure: transform };
    const { rerender } = render(<MapEditorCanvas {...props} />);
    const canvas = screen.getByTestId("map-editor-canvas");
    fireEvent.contextMenu(canvas, screenPoint(5, 4));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rotate mode" }));
    fireEvent.pointerDown(canvas, { ...screenPoint(10, 4), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(7, 7));
    rerender(<MapEditorCanvas {...props} disabled />);
    fireEvent.pointerUp(canvas);
    fireEvent.contextMenu(canvas, screenPoint(5, 4));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(transform).not.toHaveBeenCalled();

    rerender(<MapEditorCanvas {...props} />);
    fireEvent.pointerDown(canvas, { ...screenPoint(10, 4), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(7, 7));
    fireEvent.pointerUp(canvas);
    expect(transform).toHaveBeenCalledWith("wall", [{ x: 7, y: 1 }, { x: 7, y: 7 }], "rotate");
  });

  it("pans the infinite canvas camera by dragging empty space", () => {
    render(<MapEditorCanvas map={map} structures={[wall]} />);
    const canvas = screen.getByTestId("map-editor-canvas");
    const viewport = screen.getByTestId("map-editor-viewport");
    const empty = screenPoint(1, 1);

    fireEvent.pointerDown(canvas, { ...empty, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: empty.clientX + 72, clientY: empty.clientY + 72 });
    fireEvent.pointerUp(canvas);

    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.scrollTop).toBe(0);
    fireEvent.pointerMove(canvas, screenPoint(5, 4, { x: 144, y: 144 }));
    expect(screen.getByText("wall")).toBeInTheDocument();
  });
});
