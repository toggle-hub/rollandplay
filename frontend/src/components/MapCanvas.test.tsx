import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapCanvas } from "./MapCanvas";
import type { VisibleRoomState } from "../api/types";

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
const attackBase = { ability: "strength", proficient: true, attack_bonus: 0, damage_bonus: 0, to_hit: 5, damage_modifier: 3 };
const hero = {
  ...tokenBase, id: "hero", owner_user_id: "player", name: "Hero", x_m: 1, y_m: 1,
  attacks: [
    { ...attackBase, id: "sword", name: "Sword", range_m: 1.5, damage: "1d8" },
    { ...attackBase, id: "bow", name: "Bow", range_m: 20, ability: "dexterity", damage: "1d6" },
  ],
};
const goblin = {
  ...tokenBase, id: "goblin", owner_user_id: "dm", name: "Goblin", x_m: 2.5, y_m: 1,
  attacks: [{ ...attackBase, id: "scimitar", name: "Scimitar", range_m: 1.5, damage: "1d6" }],
};
const troll = { ...tokenBase, id: "troll", owner_user_id: "dm", name: "Troll", x_m: 4, y_m: 1 };
const attackWall = { ...wall, id: "attack-wall", geometry: [{ x: 3, y: 0 }, { x: 3, y: 3 }] };

function clickAt(canvas: HTMLCanvasElement, x: number, y: number) {
  fireEvent.pointerDown(canvas, { clientX: x * 72, clientY: y * 72, button: 0 });
  fireEvent.pointerUp(canvas, { clientX: x * 72, clientY: y * 72, button: 0 });
}

function renderAttackMap(onAttack = vi.fn(), onMoveToken = vi.fn()) {
  const { container } = render(
    <MapCanvas
      state={{ ...state, structures: [attackWall], visibleTokens: [hero, goblin, troll], ownTokens: [hero] }}
      movableTokenIds={new Set(["hero"])}
      onMoveToken={onMoveToken}
      onAttack={onAttack}
    />,
  );
  return container.querySelector("canvas")!;
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
      "token", { x: 3.5, y: 2.5 }, [{ x: 1, y: 1 }, { x: 3.5, y: 2.5 }],
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
      "hero", { x: 2.5, y: 1.5 }, [{ x: 1, y: 1 }, { x: 2.5, y: 1.5 }],
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
      { tokenId: "a", to: { x: 2.5, y: 2.5 } },
      { tokenId: "b", to: { x: 4.5, y: 2.5 } },
    ]);
    expect(moveOne).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("snaps an even-sized token onto grid lines so it covers whole cells", () => {
    const move = vi.fn();
    const big = { ...tokenBase, id: "big", name: "Ogre", size_m: 2, x_m: 2, y_m: 2 };
    const { container } = render(<MapCanvas state={{ ...state, visibleTokens: [big] }} onMoveToken={move} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { clientX: 2 * 72, clientY: 2 * 72, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 3.2 * 72, clientY: 3.7 * 72 });
    fireEvent.pointerUp(canvas, { clientX: 3.2 * 72, clientY: 3.7 * 72 });
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

    it("keeps the token under the pointer, ghosts its landing cell and snaps it on drop", () => {
      const { canvas, onDragTokens, onDragTokensEnd, onMoveToken } = renderDrag();
      const arc = globalThis.__canvasContext.arc;
      arc.mockClear();
      fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
      expect(onDragTokens).toHaveBeenLastCalledWith([{ tokenId: "token", to: { x: 3, y: 2 } }]);
      expect(arc).toHaveBeenCalledWith(72, 48, 12, 0, Math.PI * 2);
      expect(arc).toHaveBeenCalledWith(84, 60, 12, 0, Math.PI * 2);
      fireEvent.pointerUp(canvas, { clientX: 216, clientY: 144 });
      expect(onMoveToken).toHaveBeenCalledExactlyOnceWith("token", { x: 3.5, y: 2.5 }, [{ x: 1, y: 1 }, { x: 3.5, y: 2.5 }]);
      fireEvent.lostPointerCapture(canvas);
      expect(onDragTokensEnd).not.toHaveBeenCalled();
    });

    it("ends the live drag without moving when Escape cancels it", () => {
      const { canvas, onDragTokensEnd, onMoveToken } = renderDrag();
      fireEvent.pointerDown(canvas, { clientX: 72, clientY: 72, button: 0 });
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
      fireEvent.keyDown(canvas, { key: "Escape" });
      expect(onDragTokensEnd).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(canvas, { clientX: 216, clientY: 144 });
      expect(onMoveToken).not.toHaveBeenCalled();
      expect(onDragTokensEnd).toHaveBeenCalledTimes(1);
    });

    it("ends the live drag without moving when the token is dropped where it started", () => {
      // A token already centred on its cell, so dropping it where it was grabbed lands where it started.
      const { canvas, onDragTokensEnd, onMoveToken } = renderDrag({ ...token, x_m: 1.5, y_m: 1.5 });
      fireEvent.pointerDown(canvas, { clientX: 108, clientY: 108, button: 0 });
      fireEvent.pointerMove(canvas, { clientX: 216, clientY: 144 });
      fireEvent.pointerMove(canvas, { clientX: 108, clientY: 108 });
      fireEvent.pointerUp(canvas, { clientX: 108, clientY: 108 });
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

  it("opens the attack menu on a click without drag and attacks a target in range", () => {
    const attack = vi.fn();
    const move = vi.fn();
    const canvas = renderAttackMap(attack, move);

    clickAt(canvas, 1, 1);
    expect(move).not.toHaveBeenCalled();
    const menu = screen.getByRole("menu", { name: "Hero attacks" });
    expect(menu).toHaveTextContent("+5 to hit · 1d8+3 · 1.5 m");
    fireEvent.click(screen.getByRole("menuitem", { name: /Sword/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sword · 1.5 m — click a highlighted target");

    clickAt(canvas, 2.5, 1);
    expect(attack).toHaveBeenCalledWith("hero", "goblin", "sword");
    expect(move).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps targeting and explains why a target behind an attack-blocking wall cannot be attacked", () => {
    const attack = vi.fn();
    const canvas = renderAttackMap(attack);

    clickAt(canvas, 1, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Bow/ }));
    clickAt(canvas, 4, 1);
    expect(attack).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Blocked by a structure");

    clickAt(canvas, 2.5, 1);
    expect(attack).toHaveBeenCalledWith("hero", "goblin", "bow");
  });

  it("reports targets beyond the attack's range without attacking", () => {
    const attack = vi.fn();
    const canvas = renderAttackMap(attack);

    clickAt(canvas, 1, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Sword/ }));
    clickAt(canvas, 4, 1);
    expect(attack).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Out of range");
  });

  it("opens no attack menu for tokens the player does not control", () => {
    const canvas = renderAttackMap();

    clickAt(canvas, 2.5, 1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("cancels targeting with Escape so the next click on a target does not attack", () => {
    const attack = vi.fn();
    const canvas = renderAttackMap(attack);

    clickAt(canvas, 1, 1);
    fireEvent.click(screen.getByRole("menuitem", { name: /Sword/ }));
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    clickAt(canvas, 2.5, 1);
    expect(attack).not.toHaveBeenCalled();
  });

  it("offers attack editing only for tokens whose attacks the viewer can edit", () => {
    const edit = vi.fn();
    const { container, rerender } = render(
      <MapCanvas state={{ ...state, visibleTokens: [hero] }} onAttack={vi.fn()} onEditAttacks={edit} />,
    );
    const canvas = container.querySelector("canvas")!;
    clickAt(canvas, 1, 1);
    expect(screen.queryByRole("button", { name: "Edit attacks" })).not.toBeInTheDocument();

    fireEvent.keyDown(canvas, { key: "Escape" });
    rerender(<MapCanvas state={{ ...state, visibleTokens: [{ ...hero, attacks_editable: true }] }} onAttack={vi.fn()} onEditAttacks={edit} />);
    clickAt(canvas, 1, 1);
    fireEvent.click(screen.getByRole("button", { name: "Edit attacks" }));
    expect(edit).toHaveBeenCalledWith("hero");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("places snapped structure templates instead of selecting or moving what is under the pointer", () => {
    const place = vi.fn();
    const select = vi.fn();
    const moveToken = vi.fn();
    const attack = vi.fn();
    const { container } = render(
      <MapCanvas
        state={{ ...state, structures: [wall], visibleTokens: [hero, goblin], ownTokens: [] }}
        canMoveStructures
        onSelect={select}
        onMoveToken={moveToken}
        onAttack={attack}
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
    expect(attack).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("stops placing structures with Escape", () => {
    const cancel = vi.fn();
    const { container } = render(<MapCanvas state={state} placingStructure={{ kind: "door" }} onPlaceStructure={vi.fn()} onCancelPlacement={cancel} />);
    fireEvent.keyDown(container.querySelector("canvas")!, { key: "Escape" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
