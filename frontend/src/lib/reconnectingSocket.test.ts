import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepSocketOpen } from "./reconnectingSocket";

class FakeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  closed = false;
  close() { this.closed = true; }
}

describe("keepSocketOpen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries with growing delays while failing and starts over after connecting", () => {
    const sockets: FakeSocket[] = [];
    const opened = vi.fn();
    const closed = vi.fn();
    keepSocketOpen(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }, { onOpen: opened, onClose: closed });

    sockets[0].onopen?.();
    sockets[0].onclose?.();
    expect(closed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // The server is still down: each failed attempt waits twice as long.
    sockets[1].onclose?.();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    sockets[2].onclose?.();
    vi.advanceTimersByTime(4000);
    expect(sockets).toHaveLength(4);

    // Back up: the next drop retries after the shortest delay again, and every connect is reported.
    sockets[3].onopen?.();
    expect(opened).toHaveBeenCalledTimes(2);
    expect(opened).toHaveBeenLastCalledWith(sockets[3]);
    sockets[3].onclose?.();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(5);
  });

  it("never reconnects once stopped", () => {
    const sockets: FakeSocket[] = [];
    const stop = keepSocketOpen(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    sockets[0].onclose?.();
    stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(true);
  });
});
