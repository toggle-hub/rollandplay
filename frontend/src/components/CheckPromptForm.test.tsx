import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomMember } from "../api/types";
import { CheckPromptForm } from "./CheckPromptForm";

const members: RoomMember[] = [
  { id: "m-dm", room_id: "r", user_id: "dm", username: "Gwen", pronouns: "she/her", is_dm: true },
  { id: "m-a", room_id: "r", user_id: "alice", username: "Alice", pronouns: "she/her", sheet_id: "s-a", is_dm: false },
  { id: "m-b", room_id: "r", user_id: "bob", username: "Bob", pronouns: "he/him", sheet_id: "s-b", is_dm: false },
  { id: "m-c", room_id: "r", user_id: "carol", username: "Carol", pronouns: "they/them", sheet_id: null, is_dm: false },
];

describe("CheckPromptForm", () => {
  afterEach(cleanup);

  it("prompts a named private encounter for the chosen characters only", () => {
    const onPrompt = vi.fn(() => true);
    render(<CheckPromptForm members={members} onPrompt={onPrompt} />);
    expect(screen.queryByText(/Carol/)).not.toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Ask for the roll" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Encounter name/), { target: { value: "  Goblin ambush " } });
    fireEvent.change(screen.getByLabelText("Check"), { target: { value: "save" } });
    expect(screen.getByLabelText("Ability")).toHaveValue("dexterity");
    fireEvent.change(screen.getByLabelText("Ability"), { target: { value: "wisdom" } });
    fireEvent.change(screen.getByLabelText(/Difficulty class/), { target: { value: "15" } });
    fireEvent.click(screen.getByLabelText("Everyone with a character"));
    fireEvent.click(screen.getByLabelText(/Private/));
    fireEvent.click(submit);

    expect(onPrompt).toHaveBeenCalledWith({ title: "Goblin ambush", kind: "save", key: "wisdom", dc: 15, targetUserIds: ["alice", "bob"], isPrivate: true });
    expect(screen.getByLabelText(/Encounter name/)).toHaveValue("");
    expect(screen.getByLabelText("Everyone with a character")).not.toBeChecked();
  });

  it("keeps the form filled when the prompt could not be sent", () => {
    const onPrompt = vi.fn(() => false);
    render(<CheckPromptForm members={members} onPrompt={onPrompt} />);
    fireEvent.change(screen.getByLabelText(/Encounter name/), { target: { value: "Ambush" } });
    fireEvent.click(screen.getByLabelText(/Bob/));
    fireEvent.click(screen.getByRole("button", { name: "Ask for the roll" }));
    expect(onPrompt).toHaveBeenCalledWith(expect.objectContaining({ kind: "skill", key: "perception", dc: 10, targetUserIds: ["bob"], isPrivate: false }));
    expect(screen.getByLabelText(/Encounter name/)).toHaveValue("Ambush");
    expect(screen.getByLabelText(/Bob/)).toBeChecked();
  });
});
