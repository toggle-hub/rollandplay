import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, keepSessionFresh, onSessionExpired, refreshSession } from "./client";

const response = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("access token refresh", () => {
  it("renews an expired access cookie once and repeats the requests", async () => {
    let expired = true;
    const fetchMock = vi.fn().mockImplementation(async (path: string) => {
      if (path === "/api/auth/refresh") {
        expired = false;
        return response(200, { access_expires_in: 900 });
      }
      return expired ? response(401) : response(200, [{ id: "room" }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.all([apiFetch("/api/rooms"), apiFetch("/api/friends")]);
    expect(first).toEqual([{ id: "room" }]);
    expect(second).toEqual([{ id: "room" }]);
    // Both requests hit 401 together but share one refresh.
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/auth/refresh")).toHaveLength(1);
  });

  it("reports an expired session when the refresh cookie is rejected too", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(401, { error: { message: "sign in required" } }));
    vi.stubGlobal("fetch", fetchMock);
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    await expect(apiFetch("/api/rooms")).rejects.toMatchObject({ status: 401 });
    unsubscribe();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/rooms", "/api/auth/refresh"]);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("renews a minute before the access cookie expires while signed in", async () => {
    vi.useFakeTimers();
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      refreshes += 1;
      return response(200, { access_expires_in: 900 });
    }));
    await refreshSession();
    const stop = keepSessionFresh();
    await vi.advanceTimersByTimeAsync(839_000);
    expect(refreshes).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshes).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(900_000);
    expect(refreshes).toBe(2);
  });

  it("stops renewing and reports the session expired once the refresh cookie is rejected", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal("fetch", fetchMock);
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    keepSessionFresh();
    await vi.advanceTimersByTimeAsync(3_600_000);
    unsubscribe();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });
});

describe("error messages", () => {
  it("turns an outage without a message into a plain sentence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); } }));
    await expect(apiFetch("/api/rooms")).rejects.toMatchObject({ status: 502, message: "The server is unavailable. Try again in a moment." });
  });

  it("explains a bare server error instead of showing its status code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500, { error: { message: "" } })));
    await expect(apiFetch("/api/rooms")).rejects.toMatchObject({ status: 500, message: "Something went wrong on the server. Try again in a moment." });
  });

  it("keeps the server's own message when it sends one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(409, { error: { code: "map_in_use", message: "This map is attached to a room." } })));
    await expect(apiFetch("/api/maps/1", { method: "DELETE" })).rejects.toMatchObject({ status: 409, message: "This map is attached to a room." });
  });
});
