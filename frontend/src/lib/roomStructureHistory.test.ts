import { describe, expect, it, vi } from "vitest";
import type { MapStructure } from "../api/types";
import { castVision } from "./vision";
import { movementBarriers } from "./movement";
import { attackLineBlocked } from "./attacks";
import { StructureHistory } from "./roomStructureHistory";

const wall: MapStructure = {
  id: "wall", kind: "wall", geometry: [{ x: 2, y: 0 }, { x: 2, y: 4 }],
  blocks_vision: true, blocks_movement: true, blocks_attacks: true, cover_bonus: 0, pass_rules: {},
};

describe("StructureHistory", () => {
  it("restores a removed wall, then moves a structure back to where it was", () => {
    const history = new StructureHistory();
    const send = vi.fn(() => true);
    history.record({ action: "move", kind: "wall", requestId: "m", structureId: "wall", from: wall.geometry });
    history.record({ action: "remove", kind: "wall", requestId: "r", structureId: "wall" });
    expect(history.next()).toEqual({ label: "removed wall", ready: true });

    expect(history.undo(send)).toBe(true);
    expect(send).toHaveBeenLastCalledWith("structure.restore", { structureId: "wall" });
    expect(history.next()?.label).toBe("moved wall");
    expect(history.undo(send)).toBe(true);
    expect(send).toHaveBeenLastCalledWith("structure.move", { structureId: "wall", geometry: wall.geometry });
    expect(history.next()).toBeNull();
    expect(history.undo(send)).toBe(false);
  });

  it("undoes a placement only once the server names the new structure, and forgets rejected changes", () => {
    const history = new StructureHistory();
    const send = vi.fn(() => true);
    history.record({ action: "place", kind: "door", requestId: "p" });
    expect(history.next()).toEqual({ label: "placed door", ready: false });
    expect(history.undo(send)).toBe(false);
    expect(send).not.toHaveBeenCalled();

    history.observe({ type: "structure.created", requestId: "p", body: { structure: { id: "door-1" } } });
    expect(history.undo(send)).toBe(true);
    expect(send).toHaveBeenCalledWith("structure.remove", { structureId: "door-1" });

    history.record({ action: "remove", kind: "wall", requestId: "bad", structureId: "wall" });
    history.observe({ type: "error", requestId: "bad", body: { code: "not_found", message: "structure not found" } });
    expect(history.next()).toBeNull();
  });

  it("keeps the change when the undo could not be sent", () => {
    const history = new StructureHistory();
    history.record({ action: "remove", kind: "wall", requestId: "r", structureId: "wall" });
    expect(history.undo(() => false)).toBe(false);
    expect(history.next()?.label).toBe("removed wall");
  });
});

describe("doors at the table", () => {
  const door: MapStructure = { ...wall, id: "door", kind: "door" };
  const seesPast = (structure: MapStructure) => castVision({ x: 0, y: 2 }, 6, [structure]).some((point) => point.x > 3 && point.y > 1 && point.y < 3);

  it("block movement, sight and attacks while closed and nothing once open", () => {
    expect(movementBarriers([door])).toHaveLength(1);
    expect(seesPast(door)).toBe(false);
    expect(attackLineBlocked({ x: 0, y: 2 }, { x: 4, y: 2 }, [door])).toBe(true);

    const open = { ...door, is_open: true };
    expect(movementBarriers([open])).toHaveLength(0);
    expect(seesPast(open)).toBe(true);
    expect(attackLineBlocked({ x: 0, y: 2 }, { x: 4, y: 2 }, [open])).toBe(false);
  });

  it("never open a wall that carries the flag", () => {
    expect(movementBarriers([{ ...wall, is_open: true }])).toHaveLength(1);
  });
});
