import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameThrottle } from "./frameThrottle";

describe("createFrameThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first frame at once and only the newest frame pushed during the wait", () => {
    const send = vi.fn();
    const frames = createFrameThrottle(send, 50);
    frames.push("A");
    expect(send).toHaveBeenCalledExactlyOnceWith("A");

    vi.advanceTimersByTime(10);
    frames.push("B");
    vi.advanceTimersByTime(10);
    frames.push("C");
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("C");
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("drops the waiting frame when cancelled", () => {
    const send = vi.fn();
    const frames = createFrameThrottle(send, 50);
    frames.push("D");
    vi.advanceTimersByTime(10);
    frames.push("E");
    frames.cancel();
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledExactlyOnceWith("D");
  });
});
