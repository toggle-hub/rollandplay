import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapCanvas } from "./MapCanvas";
import type { ResolvedTokenAction, RoomToken, VisibleRoomState } from "../api/types";

const state: VisibleRoomState = {
  room: {
    id: "r",
    owner_id: "u",
    name: "Room",
    is_public: false,
    invite_code: "ABC",
    settings: {},
    rule_book: { id: "b", name: "Rules" },
  },
  activeMap: {
    id: "rm",
    name: "Map",
    width_m: 10,
    height_m: 10,
    grid_size_m: 1,
  },
  structures: [],
  visibleTokens: [],
  ownTokens: [],
  chatHistory: [],
  metersPerGrid: 1,
};

const wall = {
  id: "wall",
  kind: "wall",
  geometry: [{ x: 2, y: 1 }, { x: 2, y: 3 }],
  blocks_vision: true,
  blocks_movement: true,
  blocks_attacks: true,
  cover_bonus: 0,
  pass_rules: {},
};

function dragStructure(canvas: HTMLCanvasElement, from: [number, number], to: [number, number], shiftKey = false) {
  fireEvent.pointerDown(canvas, { clientX: from[0] * 72, clientY: from[1] * 72, button: 0 });
  fireEvent.pointerMove(canvas, { clientX: to[0] * 72, clientY: to[1] * 72, shiftKey });
  fireEvent.pointerUp(canvas, { clientX: to[0] * 72, clientY: to[1] * 72 });
}

const tokenBase = { size_m: 1, rotation_deg: 0, vision_range_m: 10, is_hidden: false, attributes: {} };
const attackBase = { ability: "strength", proficient: true, attack_bonus: 0, damage_bonus: 0, damage_type: "", to_hit: 5, damage_modifier: 3 };
const actionBase: Omit<ResolvedTokenAction, "id" | "name" | "kind" | "range_m" | "dice"> = {
  area_radius_m: 0, ability: "wisdom", proficient: false, bonus: 0, save_ability: "", half_on_save: false,
  dice_bonus: 0, ability_to_dice: true, damage_type: "", to_hit: 0, save_dc: 0, dice_modifier: 3,
};
const hero: RoomToken = {
  ...tokenBase, id: "hero", owner_user_id: "player", name: "Hero", x_m: 1, y_m: 1, can_act: true,
  attacks: [
    { ...attackBase, id: "sword", name: "Sword", range_m: 1.5, damage: "1d8" },
    { ...attackBase, id: "bow", name: "Bow", range_m: 20, ability: "dexterity", damage: "1d6" },
  ],
  actions: [
    { ...actionBase, id: "cure", name: "Cure wounds", kind: "heal", range_m: 1.5, dice: "1d8" },
    {
      ...actionBase, id: "burst", name: "Fire burst", kind: "save", range_m: 20, area_radius_m: 1, save_ability: "dexterity",
      half_on_save: true, dice: "2d6", damage_type: "fire", save_dc: 13, dice_modifier: 0, uses: { max: 2, remaining: 1 },
    },
    { ...actionBase, id: "smite", name: "Smite", kind: "attack", range_m: 1.5, dice: "2d8", uses: { max: 1, remaining: 0 } },
  ],
  items: [{ ...actionBase, id: "potion", name: "Potion of healing", kind: "heal", range_m: 1.5, dice: "2d4", ability: "", ability_to_dice: false, dice_bonus: 2, dice_modifier: 2, quantity: 3 }],
};
const goblin: RoomToken = {
  ...tokenBase, id: "goblin", owner_user_id: "dm", name: "Goblin", x_m: 2.5, y_m: 1,
  attacks: [{ ...attackBase, id: "scimitar", name: "Scimitar", range_m: 1.5, damage: "1d6" }],
};
const troll: RoomToken = { ...tokenBase, id: "troll", owner_user_id: "dm", name: "Troll", x_m: 4, y_m: 1 };
const attackWall = { ...wall, id: "attack-wall", geometry: [{ x: 3, y: 0 }, { x: 3, y: 3 }] };

function clickAt(canvas: HTMLCanvasElement, x: number, y: number) {
  fireEvent.pointerDown(canvas, { clientX: x * 72, clientY: y * 72, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: x * 72, clientY: y * 72, button: 0 });
}

function rightClickAt(canvas: HTMLCanvasElement, x: number, y: number) {
  fireEvent.pointerDown(canvas, { clientX: x * 72, clientY: y * 72, button: 2, buttons: 2 });
  fireEvent.pointerUp(canvas, { clientX: x * 72, clientY: y * 72, button: 2 });
}

function renderActionMap({ onAction = vi.fn(), onMoveToken = vi.fn(), onSelect = vi.fn(), source = hero } = {}) {
  const { container } = render(
    <MapCanvas
      state={{ ...state, structures: [attackWall], visibleTokens: [source, goblin, troll], ownTokens: [source] }}
      movableTokenIds={new Set(["hero"])}
      onMoveToken={onMoveToken}
      onSelect={onSelect}
      onAction={onAction}
    />,
  );
  return container.querySelector("canvas")!;
}

/** Right-clicks the hero, opens a wheel category and picks one of its entries. */
function choose(canvas: HTMLCanvasElement, category: string, entry: string | RegExp) {
  rightClickAt(canvas, 1, 1);
  fireEvent.click(screen.getByRole("menuitem", { name: category }));
  fireEvent.click(screen.getByRole("menuitem", { name: entry }));
}

describe("MapCanvas", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    globalThis.__canvasContext.fillText.mockClear();
  });
  it.each(["release", "pointercancel", "lostcapture", "Escape", "blur", "chorded release"])(
    "shows the ruler only during a right drag and hides it on %s, including late server results",
    (end) => {
      const measure = vi.fn();
      const { container, rerender } = render(<MapCanvas state={state} onMeasure={measure} />);
      const canvas = container.querySelector("canvas")!;
      const ctx = globalThis.__canvasContext;
      fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, button: 2, buttons: 2 });
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 0, buttons: 2 });
      expect(measure).toHaveBeenCalledWith({ x: 0, y: 0 }, { x: 3, y: 0 });
      rerender(<MapCanvas state={state} onMeasure={measure} rulerDistanceMeters={3} />);
      expect(ctx.fillText).toHaveBeenCalledWith("3.00 m", expect.any(Number), expect.any(Number));
      ctx.fillText.mockClear();
      if (end === "release") fireEvent.pointerUp(canvas, { clientX: 216, clientY: 0, button: 2 });
      else if (end === "pointercancel") fireEvent.pointerCancel(canvas);
      else if (end === "lostcapture") fireEvent.lostPointerCapture(canvas);
      else if (end === "Escape") fireEvent.keyDown(canvas, { key: "Escape" });
      else if (end === "blur") fireEvent(window, new Event("blur"));
      else fireEvent.mouseUp(canvas, { button: 2, buttons: 1 });
      expect(ctx.fillText).not.toHaveBeenCalled();
      measure.mockClear();
      rerender(<MapCanvas state={state} onMeasure={measure} rulerDistanceMeters={4} />);
      fireEvent.pointerMove(canvas, { clientX: 288, clientY: 0, buttons: 0 });
      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(measure).not.toHaveBeenCalled();
    },
  );

  it("does not measure when dragging empty space with the left button", () => {
    const measure = vi.fn();
    const { container } = render(<MapCanvas state={state} onMeasure={measure} rulerDistanceMeters={3} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 216, clientY: 0, buttons: 1 });
    fireEvent.pointerUp(canvas, { clientX: 216, clientY: 0, button: 0 });
    expect(measure).not.toHaveBeenCalled();
    expect(globalThis.__canvasContext.fillText).not.toHaveBeenCalled();
  });

  it("measures with a right drag over a structure and ignores a right click without drag", () => {
    const measure = vi.fn();
    const move = vi.fn();
    const select = vi.fn();
    const { container } = render(
      <MapCanvas state={{ ...state, structures: [wall] }} canMoveStructures onMeasure={measure} onMoveStructure={move} onSelect={select} />,
    );
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 144, clientY: 72, button: 2, buttons: 2 });
    expect(fireEvent.contextMenu(canvas, { clientX: 144, clientY: 72, button: 2 })).toBe(false);
    fireEvent.pointerMove(canvas, { clientX: 144, clientY: 144, buttons: 2 });
    fireEvent.pointerUp(canvas, { clientX: 144, clientY: 144, button: 2 });
    expect(measure).toHaveBeenCalledWith({ x: 2, y: 1 }, { x: 2, y: 2 });

    measure.mockClear();
    fireEvent.pointerDown(canvas, { clientX: 144, clientY: 144, button: 2, buttons: 2 });
    fireEvent.pointerUp(canvas, { clientX: 144, clientY: 144, button: 2 });
    expect(fireEvent.contextMenu(canvas, { clientX: 144, clientY: 144, button: 2 })).toBe(false);
    expect(measure).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("moves tokens using map coordinates when the canvas is displayed at another size", () => {
    const move = vi.fn();
    const token = {
      id: "token", name: "Hero", x_m: 1, y_m: 1, size_m: 1,
      rotation_deg: 0, vision_range_m: 10,
      is_hidden: false, attributes: {},
    };
    const { container } = render(
      <MapCanvas state={{ ...state, visibleTokens: [token] }} onMoveToken={move} />,
    );
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
    fireEvent.pointerUp(canvas, { clientX: 216, clientY: 144 });
    expect(move).toHaveBeenCalledWith(
      "token", { x: 3, y: 2 }, [{ x: 1, y: 1 }, { x: 3, y: 2 }],
    );
  });
  it("allows players to drag only their own character tokens", () => {
    const move = vi.fn();
    const ownToken = {
      id: "hero", owner_user_id: "player", name: "Hero", x_m: 1, y_m: 1, size_m: 1,
      rotation_deg: 0, vision_range_m: 10,
      is_hidden: false, attributes: {},
    };
    const enemyToken = {
      ...ownToken,
      id: "enemy",
      owner_user_id: "dm",
      name: "Enemy",
      x_m: 3,
    };
    const { container } = render(
      <MapCanvas
        state={{ ...state, visibleTokens: [ownToken, enemyToken], ownTokens: [ownToken] }}
        movableTokenIds={new Set(["hero"])}
        onMoveToken={move}
      />,
    );
    const canvas = container.querySelector("canvas")!;

    fireEvent.pointerDown(canvas, { clientX: 216, clientY: 72, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 288, clientY: 72 });
    expect(move).not.toHaveBeenCalled();

    fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 144, clientY: 72 });
    fireEvent.pointerUp(canvas, { clientX: 144, clientY: 72 });
    expect(move).toHaveBeenCalledWith(
      "hero", { x: 2, y: 1 }, [{ x: 1, y: 1 }, { x: 2, y: 1 }],
    );
  });

  it("selects only the movable tokens inside a marquee dragged across empty space", () => {
    const select = vi.fn();
    const { container } = render(
      <MapCanvas
        state={{ ...state, visibleTokens: [hero, goblin], ownTokens: [hero] }}
        movableTokenIds={new Set(["hero"])}
        onSelect={select}
      />,
    );
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 5 * 72, clientY: 3 * 72 });
    fireEvent.pointerUp(canvas, { clientX: 5 * 72, clientY: 3 * 72 });
    expect(select).toHaveBeenCalledExactlyOnceWith({ kind: "tokens", ids: ["hero"] });
  });

  it("moves every selected token together when one of them is dragged", () => {
    const moveOne = vi.fn();
    const moveMany = vi.fn();
    const select = vi.fn();
    const a = { ...tokenBase, id: "a", name: "A", x_m: 1, y_m: 1 };
    const b = { ...tokenBase, id: "b", name: "B", x_m: 3, y_m: 1 };
    const { container } = render(
      <MapCanvas
        state={{ ...state, visibleTokens: [a, b] }}
        selectedTokenIds={["a", "b"]}
        onMoveToken={moveOne}
        onMoveTokens={moveMany}
        onSelect={select}
      />,
    );
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 144, clientY: 144 });
    fireEvent.pointerUp(canvas, { clientX: 144, clientY: 144 });
    expect(moveMany).toHaveBeenCalledExactlyOnceWith([
      { tokenId: "a", to: { x: 2, y: 2 }, path: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { tokenId: "b", to: { x: 4, y: 2 }, path: [{ x: 3, y: 1 }, { x: 4, y: 2 }] },
    ]);
    expect(moveOne).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("snaps an even-sized token onto grid lines so it covers whole cells when Shift is held", () => {
    const move = vi.fn();
    const big = { ...tokenBase, id: "big", name: "Ogre", size_m: 2, x_m: 2, y_m: 2 };
    const { container } = render(<MapCanvas state={{ ...state, visibleTokens: [big] }} onMoveToken={move} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 2 * 72, clientY: 2 * 72, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 3.2 * 72, clientY: 3.7 * 72, shiftKey: true });
    fireEvent.pointerUp(canvas, { clientX: 3.2 * 72, clientY: 3.7 * 72, shiftKey: true });
    expect(move).toHaveBeenCalledWith("big", { x: 3, y: 4 }, [{ x: 2, y: 2 }, { x: 3, y: 4 }]);
  });

  describe("live token drag", () => {
    const token = { ...tokenBase, id: "token", name: "Hero", x_m: 1, y_m: 1 };
    function renderDrag(dragged = token) {
      const onDragTokens = vi.fn();
      const onDragTokensEnd = vi.fn();
      const onMoveToken = vi.fn();
      const { container } = render(
        <MapCanvas
          state={{ ...state, visibleTokens: [dragged] }}
          onDragTokens={onDragTokens}
          onDragTokensEnd={onDragTokensEnd}
          onMoveToken={onMoveToken}
        />,
      );
      return { canvas: container.querySelector("canvas")!, onDragTokens, onDragTokensEnd, onMoveToken };
    }

    it("keeps the token under the pointer and drops it there, to the hundredth of a meter", () => {
      const { canvas, onDragTokens, onDragTokensEnd, onMoveToken } = renderDrag();
      const arc = globalThis.__canvasContext.arc;
      arc.mockClear();
      fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
      expect(onDragTokens).toHaveBeenLastCalledWith([{ tokenId: "token", to: { x: 3, y: 2 } }]);
      expect(arc).toHaveBeenCalledWith(72, 48, 12, 0, Math.PI * 2);
      // Not snapped without Shift.
      expect(arc).not.toHaveBeenCalledWith(84, 60, 12, 0, Math.PI * 2);
      fireEvent.pointerUp(canvas, { clientX: 217, clientY: 145 });
      expect(onMoveToken).toHaveBeenCalledExactlyOnceWith("token", { x: 3.01, y: 2.01 }, [{ x: 1, y: 1 }, { x: 3.01, y: 2.01 }]);
      fireEvent.lostPointerCapture(canvas);
      expect(onDragTokensEnd).not.toHaveBeenCalled();
    });

    it("draws and streams the token snapped to the grid while Shift is held, and drops it there", () => {
      const { canvas, onDragTokens, onMoveToken } = renderDrag();
      const arc = globalThis.__canvasContext.arc;
      fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
      arc.mockClear();
      // Pressing Shift snaps the token at once, without moving the pointer, and the table sees it snap too.
      fireEvent.keyDown(canvas, { key: "Shift", shiftKey: true });
      expect(arc).toHaveBeenCalledWith(84, 60, 12, 0, Math.PI * 2);
      expect(arc).not.toHaveBeenCalledWith(72, 48, 12, 0, Math.PI * 2);
      expect(onDragTokens).toHaveBeenLastCalledWith([{ tokenId: "token", to: { x: 3.5, y: 2.5 } }]);
      arc.mockClear();
      fireEvent.keyUp(canvas, { key: "Shift" });
      expect(arc).toHaveBeenCalledWith(72, 48, 12, 0, Math.PI * 2);
      expect(arc).not.toHaveBeenCalledWith(84, 60, 12, 0, Math.PI * 2);
      expect(onDragTokens).toHaveBeenLastCalledWith([{ tokenId: "token", to: { x: 3, y: 2 } }]);
      fireEvent.pointerUp(canvas, { clientX: 216, clientY: 144, shiftKey: true });
      expect(onMoveToken).toHaveBeenCalledExactlyOnceWith("token", { x: 3.5, y: 2.5 }, [{ x: 1, y: 1 }, { x: 3.5, y: 2.5 }]);
    });

    it.each(["Escape", "pointercancel", "lostcapture", "blur"])("leaves the token where it was dragged when %s ends the drag", (end) => {
      const { canvas, onDragTokensEnd, onMoveToken } = renderDrag();
      fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
      if (end === "Escape") fireEvent.keyDown(canvas, { key: "Escape" });
      else if (end === "pointercancel") fireEvent.pointerCancel(canvas);
      else if (end === "lostcapture") fireEvent.lostPointerCapture(canvas);
      else fireEvent(window, new Event("blur"));
      expect(onMoveToken).toHaveBeenCalledExactlyOnceWith("token", { x: 3, y: 2 }, [{ x: 1, y: 1 }, { x: 3, y: 2 }]);
      fireEvent.pointerUp(canvas, { clientX: 288, clientY: 288 });
      expect(onMoveToken).toHaveBeenCalledTimes(1);
      expect(onDragTokensEnd).not.toHaveBeenCalled();
    });

    it("draws no outline where the dragged token started", () => {
      const { canvas } = renderDrag();
      const arc = globalThis.__canvasContext.arc;
      fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
      arc.mockClear();
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
      expect(arc).not.toHaveBeenCalledWith(24, 24, 12, 0, Math.PI * 2);
    });

    describe("into walls", () => {
      const barrier = { ...wall, geometry: [{ x: 3, y: 0 }, { x: 3, y: 4 }] };
      function renderWalled() {
        const onMoveToken = vi.fn();
        const onDragTokens = vi.fn();
        const { container } = render(
          <MapCanvas state={{ ...state, structures: [barrier], visibleTokens: [token] }} onDragTokens={onDragTokens} onMoveToken={onMoveToken} />,
        );
        return { canvas: container.querySelector("canvas")!, onMoveToken, onDragTokens };
      }

      it("stops the token next to a wall it is dragged into, and drops it there", () => {
        const { canvas, onMoveToken, onDragTokens } = renderWalled();
        fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
        fireEvent.pointerMove(canvas, { clientX: 5 * 72, clientY: 72 });
        expect(onDragTokens).toHaveBeenLastCalledWith([{ tokenId: "token", to: { x: 2.5, y: 1 } }]);
        fireEvent.pointerUp(canvas, { clientX: 5 * 72, clientY: 72 });
        expect(onMoveToken).toHaveBeenCalledExactlyOnceWith("token", { x: 2.5, y: 1 }, [{ x: 1, y: 1 }, { x: 2.5, y: 1 }]);
      });

      it("walks around a wall's end and sends the way it went", () => {
        const { canvas, onMoveToken } = renderWalled();
        fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
        fireEvent.pointerMove(canvas, { clientX: 72, clientY: 5 * 72 });
        fireEvent.pointerMove(canvas, { clientX: 5 * 72, clientY: 5 * 72 });
        fireEvent.pointerUp(canvas, { clientX: 5 * 72, clientY: 72 });
        expect(onMoveToken).toHaveBeenCalledExactlyOnceWith("token", { x: 5, y: 1 }, [{ x: 1, y: 1 }, { x: 1, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 1 }]);
      });
    });

    it("ends the live drag without moving when the token snaps back to where it started", () => {
      // A token already centred on its cell, so a Shift drop near where it was grabbed snaps to where it started.
      const { canvas, onDragTokensEnd, onMoveToken } = renderDrag({ ...token, x_m: 1.5, y_m: 1.5 });
      fireEvent.pointerDown(canvas, { clientX: 108, clientY: 108, button: 0 });
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144, shiftKey: true });
      fireEvent.pointerMove(canvas, { clientX: 100, clientY: 100, shiftKey: true });
      fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, shiftKey: true });
      expect(onDragTokensEnd).toHaveBeenCalledTimes(1);
      expect(onMoveToken).not.toHaveBeenCalled();
    });

    it("draws tokens someone else is dragging at their live position", () => {
      const arc = globalThis.__canvasContext.arc;
      arc.mockClear();
      render(<MapCanvas state={{ ...state, visibleTokens: [token] }} remoteDragPositions={new Map([["token", { x: 5, y: 5 }]])} />);
      expect(arc).toHaveBeenCalledWith(120, 120, 12, 0, Math.PI * 2);
      expect(arc).not.toHaveBeenCalledWith(24, 24, 12, 0, Math.PI * 2);
    });

    it("moves the viewer's fog of war with their token while dragging and after the drop", () => {
      // Off the grid lines, which also start with moveTo.
      const area = { tokenId: "token", origin: { x: 1, y: 1 }, polygon: [{ x: 0.5, y: 0.25 }, { x: 1, y: 0.25 }, { x: 0.5, y: 1 }] };
      const fogged = (visibleTokens = [token], visionAreas = [area]) => ({
        ...state, visibleTokens, visibility: { fog: true, visionAreas, visibleTokenIds: ["token"], visibleStructureIds: [] },
      });
      const moveTo = globalThis.__canvasContext.moveTo;
      moveTo.mockClear();
      const { container, rerender } = render(<MapCanvas state={fogged()} onMoveToken={vi.fn()} />);
      const canvas = container.querySelector("canvas")!;
      // At rest the server's polygon is drawn as sent.
      expect(moveTo).toHaveBeenCalledWith(12, 6);

      fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
      moveTo.mockClear();
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
      // Recast around the token under the pointer at (3, 2): its first ray ends 10 m east.
      expect(moveTo).toHaveBeenCalledWith(13 * 24, 2 * 24);
      expect(moveTo).not.toHaveBeenCalledWith(12, 6);
      fireEvent.pointerUp(canvas, { clientX: 216, clientY: 144 });

      // The dropped token sits on its landing cell before the server recasts its vision.
      moveTo.mockClear();
      const landed = { ...token, x_m: 3.5, y_m: 2.5 };
      rerender(<MapCanvas state={fogged([landed])} onMoveToken={vi.fn()} />);
      expect(moveTo).toHaveBeenCalledWith(13.5 * 24, 2.5 * 24);

      moveTo.mockClear();
      rerender(<MapCanvas state={fogged([landed], [{ ...area, origin: { x: 3.5, y: 2.5 } }])} onMoveToken={vi.fn()} />);
      expect(moveTo).toHaveBeenCalledWith(12, 6);
    });
  });

  it("moves structures only when tabletop structure editing is enabled", () => {
    const moveStructure = vi.fn();
    const { container, rerender } = render(
      <MapCanvas state={{ ...state, structures: [wall] }} onMoveStructure={moveStructure} />,
    );
    const canvas = container.querySelector("canvas")!;

    fireEvent.pointerDown(canvas, { clientX: 144, clientY: 144, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 216, clientY: 216 });
    fireEvent.pointerUp(canvas, { clientX: 216, clientY: 216 });
    expect(moveStructure).not.toHaveBeenCalled();

    rerender(<MapCanvas state={{ ...state, structures: [wall] }} canMoveStructures onMoveStructure={moveStructure} />);
    fireEvent.pointerDown(canvas, { clientX: 144, clientY: 144, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 216, clientY: 216 });
    fireEvent.pointerUp(canvas, { clientX: 216, clientY: 216 });
    expect(moveStructure).toHaveBeenCalledWith("wall", [{ x: 3, y: 2 }, { x: 3, y: 4 }]);
  });

  // Vertical wall centred on (2, 4); its padded frame tops out at y = 2.75 m,
  // so the rotate handle sits 24 canvas px (1 m) above, at (2, 1.75).
  const lowWall = { ...wall, geometry: [{ x: 2, y: 3 }, { x: 2, y: 5 }] };
  const lowWallHandle: [number, number] = [2, 1.75];

  it("rotates the selected structure by dragging its round handle, ahead of tokens underneath", () => {
    const moveStructure = vi.fn();
    const moveToken = vi.fn();
    const select = vi.fn();
    const { container } = render(
      <MapCanvas
        state={{ ...state, structures: [lowWall], visibleTokens: [{ ...hero, x_m: 2, y_m: 1.75 }] }}
        selectedStructureId="wall"
        canMoveStructures
        onMoveStructure={moveStructure}
        onMoveToken={moveToken}
        onSelect={select}
      />,
    );
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerMove(canvas, { clientX: 144, clientY: 126 });
    expect(canvas.style.cursor).toBe("grab");
    fireEvent.pointerMove(canvas, { clientX: 144, clientY: 288 });
    expect(canvas.style.cursor).toBe("move");

    globalThis.__canvasContext.arc.mockClear();
    fireEvent.pointerDown(canvas, { clientX: 144, clientY: 126, button: 0 });
    expect(canvas.style.cursor).toBe("grabbing");
    fireEvent.pointerMove(canvas, { clientX: 288, clientY: 288 });
    // The handle follows the pointer around the centre instead of snapping to a new bounding box.
    expect(globalThis.__canvasContext.arc).toHaveBeenLastCalledWith(102, 96, 7, 0, Math.PI * 2);
    fireEvent.pointerUp(canvas, { clientX: 288, clientY: 288 });
    expect(moveStructure).toHaveBeenCalledExactlyOnceWith("wall", [{ x: 3, y: 4 }, { x: 1, y: 4 }]);
    expect(moveToken).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("offers the rotate handle only for the selected structure while editing is enabled", () => {
    const moveStructure = vi.fn();
    const roomState = { ...state, structures: [lowWall] };
    const { container, rerender } = render(
      <MapCanvas state={roomState} canMoveStructures onMoveStructure={moveStructure} />,
    );
    const canvas = container.querySelector("canvas")!;
    dragStructure(canvas, lowWallHandle, [4, 4]);
    rerender(<MapCanvas state={roomState} selectedStructureId="wall" onMoveStructure={moveStructure} />);
    dragStructure(canvas, lowWallHandle, [4, 4]);
    expect(moveStructure).not.toHaveBeenCalled();
  });

  it("snaps handle rotation to 15-degree increments with Shift", () => {
    const moveStructure = vi.fn();
    const { container } = render(
      <MapCanvas state={{ ...state, structures: [lowWall] }} selectedStructureId="wall" canMoveStructures onMoveStructure={moveStructure} />,
    );
    const canvas = container.querySelector("canvas")!;
    const angle = 20 * Math.PI / 180;
    const target: [number, number] = [2 + 2 * Math.sin(angle), 4 - 2 * Math.cos(angle)];
    dragStructure(canvas, lowWallHandle, target);
    expect(moveStructure).toHaveBeenLastCalledWith("wall", [{ x: 2.34, y: 3.06 }, { x: 1.66, y: 4.94 }]);
    dragStructure(canvas, lowWallHandle, target, true);
    expect(moveStructure).toHaveBeenLastCalledWith("wall", [{ x: 2.26, y: 3.03 }, { x: 1.74, y: 4.97 }]);
  });

  it("moves the selected structure when its body is dragged", () => {
    const moveStructure = vi.fn();
    const { container } = render(
      <MapCanvas state={{ ...state, structures: [lowWall] }} selectedStructureId="wall" canMoveStructures onMoveStructure={moveStructure} />,
    );
    dragStructure(container.querySelector("canvas")!, [2, 4], [3, 5]);
    expect(moveStructure).toHaveBeenCalledExactlyOnceWith("wall", [{ x: 3, y: 4 }, { x: 3, y: 6 }]);
  });

  it("puts the rotate handle below structures on the top edge of the map", () => {
    const moveStructure = vi.fn();
    const topWall = { ...wall, geometry: [{ x: 1, y: 0 }, { x: 4, y: 0 }] };
    const { container } = render(
      <MapCanvas state={{ ...state, structures: [topWall] }} selectedStructureId="wall" canMoveStructures onMoveStructure={moveStructure} />,
    );
    dragStructure(container.querySelector("canvas")!, [2.5, 1.25], [4.5, 0]);
    expect(moveStructure).toHaveBeenCalledExactlyOnceWith("wall", [{ x: 2.5, y: 1.5 }, { x: 2.5, y: -1.5 }]);
  });

  it.each(["Escape", "pointercancel"])("cancels a handle rotation with %s without committing on pointerup", (cancel) => {
    const moveStructure = vi.fn();
    const { container } = render(
      <MapCanvas state={{ ...state, structures: [lowWall] }} selectedStructureId="wall" canMoveStructures onMoveStructure={moveStructure} />,
    );
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 144, clientY: 126, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 288, clientY: 288 });
    if (cancel === "Escape") fireEvent.keyDown(canvas, { key: "Escape" });
    else fireEvent.pointerCancel(canvas);
    fireEvent.pointerUp(canvas, { clientX: 288, clientY: 288 });
    expect(moveStructure).not.toHaveBeenCalled();

    dragStructure(canvas, lowWallHandle, [4, 4]);
    expect(moveStructure).toHaveBeenCalledExactlyOnceWith("wall", [{ x: 3, y: 4 }, { x: 1, y: 4 }]);
  });

  it("denies structure rotation when editing permission is revoked during a handle drag", () => {
    const moveStructure = vi.fn();
    const roomState = { ...state, structures: [lowWall] };
    const { container, rerender } = render(
      <MapCanvas state={roomState} selectedStructureId="wall" canMoveStructures onMoveStructure={moveStructure} />,
    );
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 144, clientY: 126, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 288, clientY: 288 });
    rerender(<MapCanvas state={roomState} selectedStructureId="wall" canMoveStructures={false} onMoveStructure={moveStructure} />);
    fireEvent.pointerUp(canvas, { clientX: 288, clientY: 288 });
    expect(moveStructure).not.toHaveBeenCalled();
  });

  it("opens the action wheel on a right click without drag on a token the viewer can act with", () => {
    const select = vi.fn();
    const measure = vi.fn();
    const { container } = render(
      <MapCanvas
        state={{ ...state, structures: [attackWall], visibleTokens: [hero, goblin, troll], ownTokens: [hero] }}
        onAction={vi.fn()}
        onSelect={select}
        onMeasure={measure}
      />,
    );
    const canvas = container.querySelector("canvas")!;

    rightClickAt(canvas, 6, 6);
    rightClickAt(canvas, 2.5, 1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();

    fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 2, buttons: 2 });
    fireEvent.pointerMove(canvas, { clientX: 216, clientY: 72, buttons: 2 });
    fireEvent.pointerUp(canvas, { clientX: 216, clientY: 72, button: 2 });
    expect(measure).toHaveBeenCalledWith({ x: 1, y: 1 }, { x: 3, y: 1 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    rightClickAt(canvas, 1, 1);
    const wheel = screen.getByRole("menu", { name: "Hero actions" });
    expect(select).toHaveBeenCalledExactlyOnceWith({ kind: "tokens", ids: ["hero"] });
    expect(screen.getByRole("menuitem", { name: "Attacks" })).toHaveFocus();
    expect(wheel).not.toHaveTextContent("Death save");
    expect(screen.queryByRole("menuitem", { name: "Edit actions" })).not.toBeInTheDocument();
  });

  it("moves through the wheel with the keyboard and closes the entry list before the wheel on Escape", () => {
    const canvas = renderActionMap();
    rightClickAt(canvas, 1, 1);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Attacks" }), { key: "ArrowRight" });
    expect(screen.getByRole("menuitem", { name: "Spells & abilities" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Spells & abilities" }), { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Attacks" })).toHaveFocus();

    fireEvent.click(screen.getByRole("menuitem", { name: "Attacks" }));
    const list = screen.getByRole("menu", { name: "Hero Attacks" });
    expect(list).toHaveTextContent("+5 to hit · 1d8+3 · 1.5 m");
    expect(screen.getByRole("menuitem", { name: /Sword/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Sword/ }), { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Hero Attacks" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Attacks" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Attacks" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(canvas).toHaveFocus();
  });

  it("attacks a target in range only after Roll on the confirm card", () => {
    const action = vi.fn();
    const move = vi.fn();
    const canvas = renderActionMap({ onAction: action, onMoveToken: move });

    choose(canvas, "Attacks", /Sword/);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sword · 1.5 m — click a highlighted target");

    clickAt(canvas, 2.5, 1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Confirm Sword" });
    expect(dialog).toHaveTextContent("Hero → Goblin");
    expect(dialog).toHaveTextContent("Attack roll 1d20+5 vs armor class");
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Roll" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Roll" }));
    expect(action).toHaveBeenCalledExactlyOnceWith({
      type: "action.resolve",
      body: { sourceTokenId: "hero", source: "attack", actionId: "sword", targetTokenId: "goblin" },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(move).not.toHaveBeenCalled();
  });

  it("keeps targeting and explains why a target cannot be attacked", () => {
    const action = vi.fn();
    const canvas = renderActionMap({ onAction: action });

    choose(canvas, "Attacks", /Bow/);
    clickAt(canvas, 4, 1);
    expect(screen.getByRole("status")).toHaveTextContent("Blocked by a structure");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    clickAt(canvas, 2.5, 1);
    expect(screen.getByRole("dialog", { name: "Confirm Bow" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    choose(canvas, "Attacks", /Sword/);
    clickAt(canvas, 4, 1);
    expect(screen.getByRole("status")).toHaveTextContent("Out of range");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("aims an area action at a point it can reach and sends that point", () => {
    const action = vi.fn();
    const canvas = renderActionMap({ onAction: action });
    const arc = globalThis.__canvasContext.arc;

    choose(canvas, "Spells & abilities", /Fire burst/);
    expect(screen.getByRole("status")).toHaveTextContent("Fire burst · 1 m radius — click where it lands");
    arc.mockClear();
    fireEvent.pointerMove(canvas, { clientX: 2.5 * 72, clientY: 2 * 72 });
    expect(arc).toHaveBeenCalledWith(60, 48, 24, 0, Math.PI * 2);

    clickAt(canvas, 4, 2);
    expect(screen.getByRole("status")).toHaveTextContent("Blocked by a structure");
    clickAt(canvas, 2.5, 2);
    const dialog = screen.getByRole("dialog", { name: "Confirm Fire burst" });
    expect(dialog).toHaveTextContent("Hero → area · 1 creature you can see");
    expect(dialog).toHaveTextContent("Each creature rolls a Dexterity saving throw vs DC 13");
    fireEvent.click(screen.getByRole("button", { name: "Roll" }));
    expect(action).toHaveBeenCalledExactlyOnceWith({
      type: "action.resolve",
      body: { sourceTokenId: "hero", source: "action", actionId: "burst", point: { x: 2.5, y: 2 } },
    });
  });

  it("offers no action whose uses are spent", () => {
    const canvas = renderActionMap();
    rightClickAt(canvas, 1, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Spells & abilities" }));
    const smite = screen.getByRole("menuitem", { name: /Smite/ });
    expect(smite).toHaveAttribute("aria-disabled", "true");
    expect(smite).toHaveTextContent("No uses left");
    fireEvent.click(smite);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Hero Spells & abilities" })).toBeInTheDocument();
  });

  it("lets a healing action target its own token and goes back to targeting from the confirm card", () => {
    const action = vi.fn();
    const canvas = renderActionMap({ onAction: action });

    choose(canvas, "Items", /Potion of healing/);
    clickAt(canvas, 1, 1);
    expect(screen.getByRole("dialog", { name: "Confirm Potion of healing" })).toHaveTextContent("Uses one (3 left)");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("status")).toHaveTextContent("Potion of healing · 1.5 m — click a highlighted target");
    clickAt(canvas, 1, 1);
    expect(screen.getByRole("dialog", { name: "Confirm Potion of healing" })).toHaveTextContent("Hero → Hero");
    fireEvent.click(screen.getByRole("button", { name: "Roll" }));
    expect(action).toHaveBeenCalledExactlyOnceWith({
      type: "action.resolve",
      body: { sourceTokenId: "hero", source: "item", actionId: "potion", targetTokenId: "hero" },
    });

    choose(canvas, "Attacks", /Sword/);
    clickAt(canvas, 1, 1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("rolls a quick check straight from the wheel after confirming", () => {
    const action = vi.fn();
    const canvas = renderActionMap({ onAction: action });

    choose(canvas, "Checks", "Stealth check");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Confirm Stealth check" })).toHaveTextContent("Stealth check: 1d20 plus your modifier");
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Roll" }));
    expect(action).toHaveBeenCalledExactlyOnceWith({ type: "check.quick", body: { tokenId: "hero", kind: "skill", key: "stealth" } });
  });

  it("offers a death save only to a dying character with a sheet, and nothing else while down", () => {
    const action = vi.fn();
    const down = { ...hero, hit_points: 0, max_hit_points: 10 };
    const { container, rerender } = render(<MapCanvas state={{ ...state, visibleTokens: [down] }} onAction={action} />);
    const canvas = container.querySelector("canvas")!;
    rightClickAt(canvas, 1, 1);
    expect(screen.queryByRole("menuitem", { name: "Death save" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Attacks" })).toHaveAttribute("aria-disabled", "true");

    fireEvent.keyDown(canvas, { key: "Escape" });
    rerender(<MapCanvas state={{ ...state, visibleTokens: [{ ...down, sheet_id: "sheet" }] }} onAction={action} />);
    rightClickAt(canvas, 1, 1);
    for (const name of ["Attacks", "Spells & abilities", "Items", "Checks"]) {
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.click(screen.getByRole("menuitem", { name: "Checks" }));
    expect(screen.queryByRole("menu", { name: "Hero Checks" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Death save" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll" }));
    expect(action).toHaveBeenCalledExactlyOnceWith({ type: "death.save", body: { tokenId: "hero" } });

    rerender(<MapCanvas state={{ ...state, visibleTokens: [{ ...down, sheet_id: "sheet", death_saves: { successes: 0, failures: 3, stable: false, dead: true } }] }} onAction={action} />);
    rightClickAt(canvas, 1, 1);
    expect(screen.getByRole("menu", { name: "Hero actions" })).toHaveTextContent("Dead");
    expect(screen.queryByRole("menuitem", { name: "Death save" })).not.toBeInTheDocument();
  });

  it("cancels a pending action with Escape so a later click rolls nothing", () => {
    const action = vi.fn();
    const canvas = renderActionMap({ onAction: action });

    choose(canvas, "Attacks", /Sword/);
    clickAt(canvas, 2.5, 1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    clickAt(canvas, 2.5, 1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    choose(canvas, "Attacks", /Sword/);
    clickAt(canvas, 2.5, 1);
    fireEvent.keyDown(screen.getByRole("button", { name: "Roll" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("selects a controlled token on a left click without opening a menu", () => {
    const select = vi.fn();
    const move = vi.fn();
    const canvas = renderActionMap({ onSelect: select, onMoveToken: move });

    clickAt(canvas, 1, 1);
    expect(select).toHaveBeenCalledExactlyOnceWith({ kind: "tokens", ids: ["hero"] });
    expect(move).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers action editing only for tokens whose actions the viewer can edit", () => {
    const edit = vi.fn();
    const { container, rerender } = render(
      <MapCanvas state={{ ...state, visibleTokens: [hero] }} onAction={vi.fn()} onEditActions={edit} />,
    );
    const canvas = container.querySelector("canvas")!;
    rightClickAt(canvas, 1, 1);
    expect(screen.queryByRole("menuitem", { name: "Edit actions" })).not.toBeInTheDocument();

    fireEvent.keyDown(canvas, { key: "Escape" });
    rerender(<MapCanvas state={{ ...state, visibleTokens: [{ ...hero, actions_editable: true }] }} onAction={vi.fn()} onEditActions={edit} />);
    rightClickAt(canvas, 1, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit actions" }));
    expect(edit).toHaveBeenCalledWith("hero");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("draws floating results above the tokens they belong to", () => {
    const fillText = globalThis.__canvasContext.fillText;
    render(
      <MapCanvas
        state={{ ...state, visibleTokens: [hero, goblin] }}
        floatingResults={[
          { id: "m:goblin", tokenId: "goblin", text: "-7", tone: "damage" },
          { id: "m:gone", tokenId: "gone", text: "Miss", tone: "miss" },
        ]}
      />,
    );
    expect(fillText).toHaveBeenCalledWith("-7", 60, 2);
    expect(fillText).not.toHaveBeenCalledWith("Miss", expect.any(Number), expect.any(Number));
  });

  it("places snapped structure templates instead of selecting or moving what is under the pointer", () => {
    const place = vi.fn();
    const select = vi.fn();
    const moveToken = vi.fn();
    const action = vi.fn();
    const { container } = render(
      <MapCanvas
        state={{ ...state, structures: [wall], visibleTokens: [hero, goblin], ownTokens: [] }}
        canMoveStructures
        onSelect={select}
        onMoveToken={moveToken}
        onAction={action}
        placingStructure={{ kind: "wall" }}
        onPlaceStructure={place}
      />,
    );
    const canvas = container.querySelector("canvas")!;
    expect(screen.getByText("Placing Wall — click the map to place it")).toBeInTheDocument();

    clickAt(canvas, 2.4, 1.1);
    expect(place).toHaveBeenLastCalledWith([{ x: 0, y: 1 }, { x: 4, y: 1 }]);
    clickAt(canvas, 2, 2);
    expect(place).toHaveBeenLastCalledWith([{ x: 0, y: 2 }, { x: 4, y: 2 }]);
    expect(place).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
    expect(moveToken).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("stops placing structures with Escape", () => {
    const cancel = vi.fn();
    const { container } = render(<MapCanvas state={state} placingStructure={{ kind: "door" }} onPlaceStructure={vi.fn()} onCancelPlacement={cancel} />);
    fireEvent.keyDown(container.querySelector("canvas")!, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("places the stamp turned and sized like the ghost shows it", () => {
    const place = vi.fn();
    const { container } = render(<MapCanvas state={state} placingStructure={{ kind: "wall", rotationDeg: 90, scalePercent: 50 }} onPlaceStructure={place} />);
    clickAt(container.querySelector("canvas")!, 5, 5);
    expect(place).toHaveBeenCalledWith([{ x: 5, y: 4 }, { x: 5, y: 6 }]);
  });

  it("opens and closes a door on double-click only for game masters, and never for other structures", () => {
    const door = { ...wall, id: "door", kind: "door", geometry: [{ x: 4, y: 1 }, { x: 4, y: 3 }] };
    const toggle = vi.fn();
    const { container, rerender } = render(<MapCanvas state={{ ...state, structures: [wall, door] }} canMoveStructures onToggleDoor={toggle} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.doubleClick(canvas, { clientX: 2 * 72, clientY: 2 * 72 });
    expect(toggle).not.toHaveBeenCalled();
    fireEvent.doubleClick(canvas, { clientX: 4 * 72, clientY: 2 * 72 });
    expect(toggle).toHaveBeenCalledWith(door);
    toggle.mockClear();
    rerender(<MapCanvas state={{ ...state, structures: [wall, door] }} />);
    fireEvent.doubleClick(canvas, { clientX: 4 * 72, clientY: 2 * 72 });
    expect(toggle).not.toHaveBeenCalled();
  });
});
