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
const other: MapStructure = { ...wall, id: "other", geometry: [{ x: 12, y: 10 }, { x: 18, y: 10 }] };

const pixelsPerMeter = 24 * 0.85;
const screenPoint = (x: number, y: number, camera = { x: 72, y: 72 }) => ({ clientX: camera.x + x * pixelsPerMeter, clientY: camera.y + y * pixelsPerMeter });
/** The round rotation handle sits 28 screen pixels above the top-center of the selection frame. */
const rotateHandle = (centerX: number, top: number) => ({ ...screenPoint(centerX, top), clientY: screenPoint(centerX, top).clientY - 28 });

function drag(canvas: HTMLElement, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, options: { shiftKey?: boolean; button?: number } = {}) {
  fireEvent.pointerDown(canvas, { ...from, button: options.button ?? 0, shiftKey: options.shiftKey });
  fireEvent.pointerMove(canvas, { ...to, shiftKey: options.shiftKey });
  fireEvent.pointerUp(canvas, to);
}

function Editor({ initialSelection = [], initialStructures = [wall, other] }: { initialSelection?: string[]; initialStructures?: MapStructure[] }) {
  const [structures, setStructures] = useState(initialStructures);
  const [selected, setSelected] = useState(initialSelection);
  return <>
    <MapEditorCanvas
      map={map}
      structures={structures}
      selectedStructureIds={selected}
      onSelectStructures={setSelected}
      onTransformStructures={(changes) => setStructures((current) => current.map((structure) => changes.find((change) => change.id === structure.id) ? { ...structure, geometry: changes.find((change) => change.id === structure.id)!.geometry } : structure))}
    />
    <output data-testid="geometry">{JSON.stringify(Object.fromEntries(structures.map((structure) => [structure.id, structure.geometry])))}</output>
    <output data-testid="selection">{JSON.stringify(selected)}</output>
  </>;
}

const geometryOf = (id: string) => JSON.parse(screen.getByTestId("geometry").textContent!)[id];
const selection = () => JSON.parse(screen.getByTestId("selection").textContent!);

describe("MapEditorCanvas", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    globalThis.__canvasContext.arc.mockClear();
    globalThis.__canvasContext.fillRect.mockClear();
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

  it("selects and moves a clicked structure in one drag", () => {
    const transform = vi.fn();
    const select = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} onSelectStructures={select} onTransformStructures={transform} />);

    drag(screen.getByTestId("map-editor-canvas"), screenPoint(4, 4), screenPoint(5, 6));

    expect(select).toHaveBeenCalledWith(["wall"]);
    expect(transform).toHaveBeenCalledWith([{ id: "wall", geometry: [{ x: 5, y: 6 }, { x: 11, y: 6 }] }], "move");
  });

  it("zooms in and out around the pointer with the plain mouse wheel", () => {
    render(<MapEditorCanvas map={map} structures={[wall]} />);
    const canvas = screen.getByTestId("map-editor-canvas");
    const pointer = screenPoint(5, 4);

    fireEvent.wheel(canvas, { ...pointer, deltaY: -100 });
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.pointerMove(canvas, pointer);
    expect(screen.getByText("wall")).toBeInTheDocument();

    fireEvent.wheel(canvas, { ...pointer, deltaY: 100 });
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("draws the square resize handles and the round rotate handle together, without choosing a mode", () => {
    const { rerender } = render(<MapEditorCanvas map={map} structures={[wall]} />);
    expect(globalThis.__canvasContext.arc).not.toHaveBeenCalled();

    rerender(<MapEditorCanvas map={map} structures={[wall]} selectedStructureIds={["wall"]} />);
    const handleSize = 10 / 0.85;
    expect(globalThis.__canvasContext.fillRect.mock.calls.filter(([, , width, height]) => width === handleSize && height === handleSize)).toHaveLength(4);
    expect(globalThis.__canvasContext.arc).toHaveBeenCalledWith(7 * 24, expect.closeTo(4 * 24 - 28 / 0.85), 7 / 0.85, 0, Math.PI * 2);
  });

  it("resizes a selection from a corner handle while keeping the opposite end fixed", () => {
    const transform = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} selectedStructureIds={["wall"]} onTransformStructures={transform} />);

    drag(screen.getByTestId("map-editor-canvas"), screenPoint(10, 4), screenPoint(13, 4));

    expect(transform).toHaveBeenCalledWith([{ id: "wall", geometry: [{ x: 4, y: 4 }, { x: 13, y: 4 }] }], "resize");
  });

  it("rotates the selection by dragging the round handle, and body drags still move it", () => {
    render(<Editor initialSelection={["wall"]} />);
    const canvas = screen.getByTestId("map-editor-canvas");

    drag(canvas, rotateHandle(7, 4), screenPoint(10, 4));
    expect(geometryOf("wall")).toEqual([{ x: 7, y: 1 }, { x: 7, y: 7 }]);

    drag(canvas, screenPoint(7, 5), screenPoint(8, 5));
    expect(geometryOf("wall")).toEqual([{ x: 8, y: 1 }, { x: 8, y: 7 }]);
  });

  it("snaps handle rotation to 15 degrees when Shift is held", () => {
    const transform = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} selectedStructureIds={["wall"]} onTransformStructures={transform} />);

    drag(screen.getByTestId("map-editor-canvas"), rotateHandle(7, 4), screenPoint(10, 5), { shiftKey: true });

    expect(transform).toHaveBeenCalledWith([{ id: "wall", geometry: [{ x: 7.78, y: 1.1 }, { x: 6.22, y: 6.9 }] }], "rotate");
  });

  it("selects every structure touched by an area drag and transforms them as one group", () => {
    render(<Editor />);
    const canvas = screen.getByTestId("map-editor-canvas");

    drag(canvas, screenPoint(2, 2), screenPoint(19, 11));
    expect(selection()).toEqual(["wall", "other"]);

    // The group frame spans (4,4)–(18,10); a half turn swaps both walls across its center (11,7).
    drag(canvas, rotateHandle(11, 4), screenPoint(11, 12));
    expect(geometryOf("wall")).toEqual([{ x: 18, y: 10 }, { x: 12, y: 10 }]);
    expect(geometryOf("other")).toEqual([{ x: 10, y: 4 }, { x: 4, y: 4 }]);

    drag(canvas, screenPoint(15, 10), screenPoint(15, 11));
    expect(geometryOf("wall")).toEqual([{ x: 18, y: 11 }, { x: 12, y: 11 }]);
    expect(geometryOf("other")).toEqual([{ x: 10, y: 5 }, { x: 4, y: 5 }]);
    expect(selection()).toEqual(["wall", "other"]);
  });

  it("scales a group from a corner around the opposite corner", () => {
    render(<Editor initialSelection={["wall", "other"]} />);

    drag(screen.getByTestId("map-editor-canvas"), screenPoint(18, 10), screenPoint(32, 16));

    expect(geometryOf("wall")).toEqual([{ x: 4, y: 4 }, { x: 16, y: 4 }]);
    expect(geometryOf("other")).toEqual([{ x: 20, y: 16 }, { x: 32, y: 16 }]);
  });

  it("toggles structures in and out of the selection with Shift-click and clears it on empty clicks", () => {
    render(<Editor />);
    const canvas = screen.getByTestId("map-editor-canvas");
    const click = (point: { clientX: number; clientY: number }, shiftKey = false) => {
      fireEvent.pointerDown(canvas, { ...point, button: 0, shiftKey });
      fireEvent.pointerUp(canvas, point);
    };

    click(screenPoint(5, 4));
    click(screenPoint(14, 10), true);
    expect(selection()).toEqual(["wall", "other"]);
    click(screenPoint(5, 4), true);
    expect(selection()).toEqual(["other"]);
    click(screenPoint(2, 14));
    expect(selection()).toEqual([]);
    expect(geometryOf("wall")).toEqual(wall.geometry);
  });

  it("selects and moves grouped structures together", () => {
    render(<Editor initialStructures={[{ ...wall, group_id: "g" }, { ...other, group_id: "g" }]} />);
    const canvas = screen.getByTestId("map-editor-canvas");

    drag(canvas, screenPoint(5, 4), screenPoint(5, 5));

    expect(selection()).toEqual(["wall", "other"]);
    expect(geometryOf("wall")).toEqual([{ x: 4, y: 5 }, { x: 10, y: 5 }]);
    expect(geometryOf("other")).toEqual([{ x: 12, y: 11 }, { x: 18, y: 11 }]);

    fireEvent.pointerDown(canvas, { ...screenPoint(14, 11), button: 0, shiftKey: true });
    fireEvent.pointerUp(canvas, screenPoint(14, 11));
    expect(selection()).toEqual([]);
  });

  it("previews the stamp under the pointer and places it on click with the Place tool", () => {
    const place = vi.fn();
    const select = vi.fn();
    const transform = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} selectedStructureIds={["wall"]} tool="place" stamp={{ kind: "door", rotationDeg: 0, scalePercent: 100 }} onPlace={place} onSelectStructures={select} onTransformStructures={transform} />);
    const canvas = screen.getByTestId("map-editor-canvas");

    globalThis.__canvasContext.setLineDash.mockClear();
    fireEvent.pointerMove(canvas, screenPoint(14, 14));
    expect(globalThis.__canvasContext.setLineDash).toHaveBeenCalledWith([8, 5]);
    expect(canvas.style.cursor).toBe("crosshair");
    expect(screen.queryByText("Vision")).not.toBeInTheDocument();

    drag(canvas, screenPoint(5, 4), screenPoint(8, 8));
    expect(place).toHaveBeenCalledExactlyOnceWith({ x: 5, y: 4 });
    expect(select).not.toHaveBeenCalled();
    expect(transform).not.toHaveBeenCalled();
  });

  it("opens structure actions on a right click without drag, while a right drag still pans", () => {
    const action = vi.fn();
    const select = vi.fn();
    const actions = [{ id: "front", label: "Bring to front" }, { id: "delete", label: "Delete", danger: true }];
    render(<MapEditorCanvas map={map} structures={[wall]} contextActions={actions} onSelectStructures={select} onContextAction={action} />);
    const canvas = screen.getByTestId("map-editor-canvas");

    drag(canvas, screenPoint(1, 1), { clientX: screenPoint(1, 1).clientX + 72, clientY: screenPoint(1, 1).clientY }, { button: 2 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const onWall = { ...screenPoint(5, 4), clientX: screenPoint(5, 4).clientX + 72 };
    fireEvent.pointerDown(canvas, { ...onWall, button: 2 });
    fireEvent.pointerUp(canvas, { ...onWall, button: 2 });
    expect(select).toHaveBeenCalledWith(["wall"]);
    const menu = screen.getByRole("menu", { name: "Structure actions" });
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Bring to front", "Delete"]);
    expect(menu).toContainElement(document.activeElement as HTMLElement);

    fireEvent.click(screen.getByRole("menuitem", { name: "Bring to front" }));
    expect(action).toHaveBeenCalledWith("front");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("cancels a drag with Escape or pointercancel", () => {
    const transform = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} selectedStructureIds={["wall"]} onTransformStructures={transform} />);
    const canvas = screen.getByTestId("map-editor-canvas");

    for (const cancellation of ["Escape", "pointercancel"]) {
      fireEvent.pointerDown(canvas, { ...rotateHandle(7, 4), button: 0 });
      fireEvent.pointerMove(canvas, screenPoint(10, 4));
      if (cancellation === "Escape") fireEvent.keyDown(canvas, { key: "Escape" });
      else fireEvent.pointerCancel(canvas);
      fireEvent.pointerUp(canvas, screenPoint(10, 4));
    }
    expect(transform).not.toHaveBeenCalled();
  });

  it("cancels a transform when disabled", () => {
    const transform = vi.fn();
    const props = { map, structures: [wall], selectedStructureIds: ["wall"], onTransformStructures: transform };
    const { rerender } = render(<MapEditorCanvas {...props} />);
    const canvas = screen.getByTestId("map-editor-canvas");
    fireEvent.pointerDown(canvas, { ...rotateHandle(7, 4), button: 0 });
    fireEvent.pointerMove(canvas, screenPoint(10, 4));
    rerender(<MapEditorCanvas {...props} disabled />);
    fireEvent.pointerUp(canvas, screenPoint(10, 4));
    expect(transform).not.toHaveBeenCalled();

    rerender(<MapEditorCanvas {...props} />);
    drag(canvas, rotateHandle(7, 4), screenPoint(10, 4));
    expect(transform).toHaveBeenCalledWith([{ id: "wall", geometry: [{ x: 7, y: 1 }, { x: 7, y: 7 }] }], "rotate");
  });

  it("pans with a right-button drag, while a left drag on empty space selects instead", () => {
    const select = vi.fn();
    render(<MapEditorCanvas map={map} structures={[wall]} onSelectStructures={select} />);
    const canvas = screen.getByTestId("map-editor-canvas");
    const empty = screenPoint(1, 1);
    const shifted = { clientX: empty.clientX + 72, clientY: empty.clientY + 72 };

    drag(canvas, empty, shifted);
    fireEvent.pointerMove(canvas, screenPoint(5, 4));
    expect(screen.getByText("wall")).toBeInTheDocument();

    drag(canvas, empty, shifted, { button: 2 });
    fireEvent.pointerMove(canvas, screenPoint(5, 4));
    expect(screen.queryByText("wall")).not.toBeInTheDocument();
    fireEvent.pointerMove(canvas, screenPoint(5, 4, { x: 144, y: 144 }));
    expect(screen.getByText("wall")).toBeInTheDocument();
  });
});
