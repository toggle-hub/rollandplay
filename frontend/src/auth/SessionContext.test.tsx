import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../AppShell";
import { SessionProvider, destinationTtlMs, localDestination, loginDestination, rememberDestination } from "./SessionContext";

vi.mock("../routes/LandingPage", () => ({ LandingPage: () => <main>Public story</main> }));

const user = { id: "user-1", username: "Storykeeper", email: "keeper@example.com", pronouns: "they/them", profile_complete: true };
type TestResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
const response = (status: number, body: unknown = {}): TestResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}{location.search}{location.hash}</output>;
}

function openApp(path: string, strict = false) {
  const app = <MemoryRouter initialEntries={[path]}><SessionProvider><AppShell /><LocationProbe /></SessionProvider></MemoryRouter>;
  return render(strict ? <StrictMode>{app}</StrictMode> : app);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("session boundary", () => {
  it("does not mount protected tools or fetch feature data until the session is validated", async () => {
    let resolveSession!: (value: TestResponse) => void;
    const fetchMock = vi.fn().mockImplementation((path: string) => path === "/api/me"
      ? new Promise((resolve) => { resolveSession = resolve; })
      : Promise.resolve(response(200, [])));
    vi.stubGlobal("fetch", fetchMock);
    openApp("/rooms");
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Room name")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/me"]);
    await act(async () => { resolveSession(response(200, user)); });
    expect(await screen.findByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Room name")).toBeInTheDocument();
    expect(screen.getByText("Storykeeper (they/them)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rooms" })).toHaveAttribute("aria-current", "page");
  });

  it.each(["/rooms", "/rooms/private-room?tab=chat#latest", "/join/TAVERN42", "/friends", "/rule-books", "/sheets", "/maps", "/maps/private-map/edit", "/profile"])("gates signed-out deep links at %s without fetching protected data", async (path) => {
    const fetchMock = vi.fn().mockResolvedValue(response(401));
    vi.stubGlobal("fetch", fetchMock);
    openApp(path);
    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/login");
    expect(loginDestination()).toBe(path);
    // Only a refresh attempt follows the rejected session check; no protected data is fetched.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/me", "/api/auth/refresh"]);
  });

  it.each(["network", "server"])("keeps tools hidden on a %s failure and supports retry", async (failure) => {
    const fetchMock = vi.fn().mockImplementation((path: string) => Promise.resolve(response(200, path === "/api/me" ? user : [])));
    if (failure === "network") fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    else fetchMock.mockResolvedValueOnce(response(503));
    vi.stubGlobal("fetch", fetchMock);
    openApp("/rooms");
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Room name")).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByLabelText("Room name")).toBeInTheDocument();
  });

  it("requires first sign-in profile details before mounting workspace tools, with pronouns optional", async () => {
    const incomplete = { ...user, username: "keeper", pronouns: "", profile_complete: false };
    const complete = { ...user, username: "Keeper", pronouns: "", profile_complete: true };
    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/me" && init?.method === "PATCH") return Promise.resolve(response(200, complete));
      return Promise.resolve(response(200, path === "/api/me" ? incomplete : []));
    });
    vi.stubGlobal("fetch", fetchMock);
    openApp("/rooms");
    expect(await screen.findByRole("heading", { level: 1, name: "What should we call you?" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByLabelText("Room name")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Keeper" } });
    fireEvent.click(screen.getByRole("button", { name: /save and continue/i }));
    expect(await screen.findByLabelText("Room name")).toBeInTheDocument();
    // Without pronouns, the name shows alone.
    expect(screen.getByRole("link", { name: "Your profile: Keeper" })).toHaveAttribute("href", "/profile");
    expect(fetchMock).toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ username: "Keeper", pronouns: "" }) }));
  });

  it("removes the workspace after a successful sign-out", async () => {
    const fetchMock = vi.fn().mockImplementation((path: string) => Promise.resolve(response(path === "/api/auth/logout" ? 204 : 200, path === "/api/me" ? user : [])));
    vi.stubGlobal("fetch", fetchMock);
    openApp("/rooms");
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Public story")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Room name")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST", credentials: "include" }));
  });

  it("clears protected UI when a feature request reports an expired session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((path: string) => Promise.resolve(response(path === "/api/me" ? 200 : 401, path === "/api/me" ? user : {}))));
    openApp("/rooms");
    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Room name")).not.toBeInTheDocument();
  });

  it("does not log out a validated session for an ordinary feature server failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((path: string) => Promise.resolve(response(path === "/api/me" ? 200 : 500, path === "/api/me" ? user : { error: { message: "Service unavailable" } }))));
    openApp("/rooms");
    // Rooms and rule books both fail; each surfaces its own alert.
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    screen.getAllByRole("alert").forEach((alert) => expect(alert).toHaveTextContent("Service unavailable"));
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Room name")).toBeInTheDocument();
  });

  it("consumes a magic link once in StrictMode and returns to the remembered destination", async () => {
    rememberDestination("/rooms?campaign=one#table");
    let resolveSession!: (value: TestResponse) => void;
    const initialSession = new Promise<TestResponse>((resolve) => { resolveSession = resolve; });
    const fetchMock = vi.fn().mockImplementation((path: string) => path === "/api/me"
      ? initialSession
      : Promise.resolve(response(200, path === "/api/auth/consume" ? { user } : [])));
    vi.stubGlobal("fetch", fetchMock);
    openApp("/auth/consume?token=single-use-token", true);
    expect(await screen.findByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Current path")).toHaveTextContent("/rooms?campaign=one#table"));
    expect(fetchMock.mock.calls.filter(([path]) => path === "/api/auth/consume")).toHaveLength(1);
    expect(loginDestination()).toBe("/rooms");
    await act(async () => { resolveSession(response(401)); });
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
  });

  it("opens an invite link after signing in from the emailed link in another tab", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401)));
    openApp("/join/TAVERN42");
    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    cleanup();

    // The sign-in link opens a new tab: only localStorage carries over.
    const preview = { room_id: "room-1", name: "The Gilded Tankard", rule_book: { id: "book-1", name: "Tavern Rules" }, requires_password: false, member: null };
    const fetchMock = vi.fn().mockImplementation((path: string) => {
      if (path === "/api/me") return Promise.resolve(response(401));
      if (path === "/api/auth/consume") return Promise.resolve(response(200, { user }));
      if (path === "/api/invites/TAVERN42") return Promise.resolve(response(200, preview));
      return Promise.resolve(response(200, []));
    });
    vi.stubGlobal("fetch", fetchMock);
    openApp("/auth/consume?token=from-email");
    expect(await screen.findByRole("region", { name: "Invite details" })).toHaveTextContent("The Gilded Tankard");
    expect(screen.getByLabelText("Invite code")).toHaveValue("TAVERN42");
    expect(screen.getByLabelText("Current path")).toHaveTextContent(/^\/rooms$/);
    expect(loginDestination()).toBe("/rooms");
  });

  it("forgets a remembered page once it is too old", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    rememberDestination("/join/TAVERN42");
    vi.spyOn(Date, "now").mockReturnValue(now + destinationTtlMs - 1000);
    expect(loginDestination()).toBe("/join/TAVERN42");
    vi.spyOn(Date, "now").mockReturnValue(now + destinationTtlMs + 1000);
    expect(loginDestination()).toBe("/rooms");
  });

  it.each(["https://evil.example/rooms", "//evil.example/rooms", "/\\evil.example/rooms", "/login", "/auth/consume?token=old", "/rooms/../../login"])("rejects an unsafe or non-workspace destination: %s", (path) => {
    expect(localDestination(path)).toBeNull();
  });
});
