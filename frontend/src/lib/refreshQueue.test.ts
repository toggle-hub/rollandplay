import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefreshQueue } from "./refreshQueue";
import { partsToReload, type RoomPart } from "./roomEvents";

describe("createRefreshQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reloads only the room state, once, for a token move's pair of events", async () => {
    const run = vi.fn(async (_parts: ReadonlySet<RoomPart>) => {});
    const queue = createRefreshQueue(run, 30);
    // The server answers one move with token.moved followed by vision.update.
    const done = Promise.all(["token.moved", "vision.update"].map((type) => queue.request(...partsToReload(type))));
    await vi.advanceTimersByTimeAsync(30);
    await done;
    expect(run).toHaveBeenCalledTimes(1);
    expect([...run.mock.calls[0][0]]).toEqual(["state"]);
  });

  it("keeps member and map reloads to their own events", () => {
    expect(partsToReload("member.joined")).toEqual(["members"]);
    expect(partsToReload("map.activated")).toEqual(["state", "maps"]);
    expect(partsToReload("check.changed")).toEqual(["state"]);
    expect(partsToReload("chat.message")).toEqual([]);
    expect(partsToReload("token.dragging")).toEqual([]);
  });

  it("runs once more after a running reload for parts requested meanwhile, never overlapping", async () => {
    let finish!: () => void;
    let active = 0;
    let maxActive = 0;
    const batches: string[][] = [];
    const queue = createRefreshQueue<RoomPart>(async (parts) => {
      batches.push([...parts]);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => { finish = resolve; });
      active--;
    }, 30);

    const first = vi.fn();
    void queue.request("state").then(first);
    await vi.advanceTimersByTimeAsync(30);
    expect(batches).toEqual([["state"]]);

    // Arrives while the first reload is still waiting for the server.
    const second = vi.fn();
    void queue.request("members").then(second);
    void queue.request("state");
    await vi.advanceTimersByTimeAsync(100);
    expect(batches).toHaveLength(1);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30);
    expect(batches).toEqual([["state"], ["members", "state"]]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(second).toHaveBeenCalled();
    expect(maxActive).toBe(1);
  });

  it("drops waiting reloads when stopped and settles their promises", async () => {
    const run = vi.fn(async () => {});
    const queue = createRefreshQueue<RoomPart>(run, 30);
    const settled = vi.fn();
    void queue.request("state").then(settled);
    queue.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalled();
    await queue.request("maps");
    expect(run).not.toHaveBeenCalled();
  });
});
