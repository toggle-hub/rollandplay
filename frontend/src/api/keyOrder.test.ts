import { describe, expect, it } from "vitest";
import { applyKeyOrder, restoreKeyOrder } from "./keyOrder";

describe("key order", () => {
  it("reorders objects at every depth and keeps unknown keys after the known ones", () => {
    const value = { level: 1, wisdom: 10, strength: 8, saves: { wisdom: true, strength: false }, attacks: [{ name: "Bite", id: "bite" }], added: true };
    const ordered = applyKeyOrder(value, {
      keys: ["strength", "wisdom", "gone", "level", "saves", "attacks"],
      children: { saves: { keys: ["strength", "wisdom"] }, attacks: { items: [{ keys: ["id", "name"] }] } },
    });

    expect(JSON.stringify(ordered)).toBe('{"strength":8,"wisdom":10,"level":1,"saves":{"strength":false,"wisdom":true},"attacks":[{"id":"bite","name":"Bite"}],"added":true}');
    expect(ordered).toEqual(value);
  });

  it("keeps a __proto__ key as data", () => {
    const value = JSON.parse('{"b":1,"__proto__":{"polluted":true}}');
    const ordered = applyKeyOrder(value, { keys: ["__proto__", "b"] });

    expect(Object.keys(ordered)).toEqual(["__proto__", "b"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("applies key_order to every record of a response and drops it", () => {
    const body = [
      { id: "a", data: { a: 2, z: 1 }, key_order: { data: { keys: ["z", "a"] } } },
      { id: "b", data: { a: 2, z: 1 } },
    ];
    const restored = restoreKeyOrder(body);

    expect(restored.map((record) => Object.keys(record.data))).toEqual([["z", "a"], ["a", "z"]]);
    expect(restored[0]).not.toHaveProperty("key_order");
  });
});
