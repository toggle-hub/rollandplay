import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LoginPage", () => {
  it("calls magic-link endpoint and shows check email state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));
    await waitFor(() =>
      expect(screen.getByText(/check your email/i)).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/magic-link",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("keeps a rejected submission editable and allows another attempt", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Connection unavailable"))
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "person@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection unavailable");
    expect(screen.getByLabelText("Email address")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("person@example.com");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
