import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "../auth/SessionContext";
import { ToastProvider } from "../components/Toast";
import { NotificationsProvider, useNotifications } from "./NotificationsContext";

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  close() {}
  push(body: unknown) { this.onmessage?.({ data: JSON.stringify({ type: "notification", requestId: null, body }) }); }
}

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const me = { id: "u1", username: "Gwen", email: "g@example.com", pronouns: "she/her", profile_complete: true };
const request = { id: "f1", requester_user_id: "u2", addressee_user_id: "u1", status: "pending", other_user: { id: "u2", username: "Asha", email: "a@example.com", pronouns: "she/her", profile_complete: true }, direction: "inbound" };

function Count() {
  const { friend_requests, room_invitations } = useNotifications();
  return <p>{friend_requests.length + room_invitations.length} waiting</p>;
}

async function flush() {
  await act(async () => {});
}

describe("NotificationsProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeSocket.all = [];
  });

  it("reloads and alerts on a pushed notification, and reconnects after the socket drops", async () => {
    vi.useFakeTimers();
    let waiting: unknown[] = [];
    const loads = vi.fn();
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = input.toString();
      if (path === "/api/me") return json(me);
      if (path === "/api/auth/refresh") return json({ access_expires_in: 900 });
      if (path === "/api/notifications") {
        loads();
        return json({ friend_requests: waiting, room_invitations: [] });
      }
      throw new Error(`unexpected ${path}`);
    }));
    render(<SessionProvider><ToastProvider><NotificationsProvider><Count /></NotificationsProvider></ToastProvider></SessionProvider>);
    await flush();
    expect(screen.getByText("0 waiting")).toBeInTheDocument();
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0].url).toMatch(/\/api\/notifications\/ws$/);

    waiting = [request];
    await act(async () => FakeSocket.all[0].push({ kind: "friend.requested", actor: { id: "u2", username: "Asha", pronouns: "she/her" } }));
    await flush();
    expect(screen.getByText("1 waiting")).toBeInTheDocument();
    expect(screen.getByText("Asha (she/her) sent you a friend request.")).toBeInTheDocument();

    // Whatever was missed while disconnected is reloaded once the socket is back.
    act(() => FakeSocket.all[0].onclose?.());
    expect(FakeSocket.all).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(FakeSocket.all).toHaveLength(2);
    waiting = [];
    const before = loads.mock.calls.length;
    await act(async () => FakeSocket.all[1].onopen?.());
    await flush();
    expect(loads.mock.calls.length).toBe(before + 1);
    expect(screen.getByText("0 waiting")).toBeInTheDocument();
  });
});
