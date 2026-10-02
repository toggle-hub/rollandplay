import { describe, expect, it } from "vitest";
import type { MapStructure } from "../api/types";
import { attackLineBlocked, attackSummary, attackTargetStatus } from "./attacks";

const wall: MapStructure = {
  id: "wall",
  kind: "wall",
  geometry: [{ x: 5, y: 0 }, { x: 5, y: 10 }],
  blocks_vision: true,
  blocks_movement: true,
  blocks_attacks: true,
  cover_bonus: 0,
  pass_rules: {},
};

describe("attack targeting", () => {
  it("blocks a line that crosses an attack-blocking wall", () => {
    expect(attackLineBlocked({ x: 1, y: 1 }, { x: 6, y: 1 }, [wall])).toBe(true);
    expect(attackLineBlocked({ x: 1, y: 1 }, { x: 4, y: 1 }, [wall])).toBe(false);
  });

  it("lets attacks through walls whose pass rules allow attacks", () => {
    expect(attackLineBlocked({ x: 1, y: 1 }, { x: 6, y: 1 }, [{ ...wall, pass_rules: { attacks: true } }])).toBe(false);
  });

  it("ignores hidden structures and structures that do not block attacks", () => {
    expect(attackLineBlocked({ x: 1, y: 1 }, { x: 6, y: 1 }, [{ ...wall, is_hidden: true }])).toBe(false);
    expect(attackLineBlocked({ x: 1, y: 1 }, { x: 6, y: 1 }, [{ ...wall, blocks_attacks: false }])).toBe(false);
  });

  it("blocks on the closing edge of a polygon", () => {
    const room = { ...wall, geometry: [{ x: 5, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 10 }, { x: 5, y: 10 }] };
    // Only the closing edge (5,10)->(5,0) lies between the points.
    expect(attackLineBlocked({ x: 1, y: 5 }, { x: 6, y: 5 }, [room])).toBe(true);
  });

  it("reports out of range before blocked, and valid when in range and clear", () => {
    expect(attackTargetStatus({ x: 1, y: 1 }, { x: 6, y: 1 }, 2, [wall])).toBe("out_of_range");
    expect(attackTargetStatus({ x: 1, y: 1 }, { x: 6, y: 1 }, 20, [wall])).toBe("blocked");
    expect(attackTargetStatus({ x: 1, y: 1 }, { x: 2.5, y: 1 }, 1.5, [wall])).toBe("valid");
  });

  it("summarises attack bonuses, damage and range", () => {
    const sword = { id: "s", name: "Sword", range_m: 1.5, ability: "strength", proficient: true, attack_bonus: 0, damage: "1d8", damage_bonus: 0 };
    expect(attackSummary({ ...sword, to_hit: 5, damage_modifier: 3 })).toBe("+5 to hit · 1d8+3 · 1.5 m");
    expect(attackSummary({ ...sword, to_hit: 0, damage_modifier: -1 })).toBe("+0 to hit · 1d8-1 · 1.5 m");
  });
});
