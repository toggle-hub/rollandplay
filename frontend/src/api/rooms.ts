import { deleteJSON, postJSON } from "./client";

/** The shareable invite link for a room: opening it signs the player in if needed and looks the code up. */
export function inviteLink(inviteCode: string): string {
  return `${window.location.origin}/join/${encodeURIComponent(inviteCode)}`;
}

/** Copies a room's invite link to the clipboard. Rejects when the browser doesn't allow it. */
export async function copyInviteLink(inviteCode: string): Promise<void> {
  if (!navigator.clipboard) throw new Error("This browser can’t copy from here.");
  await navigator.clipboard.writeText(inviteLink(inviteCode));
}

/** Deletes a room with everything played in it. Only the game master who created it may. */
export function deleteRoom(roomId: string): Promise<void> {
  return deleteJSON<void>(`/api/rooms/${encodeURIComponent(roomId)}`);
}

/** Leaves a room; the player's character tokens leave its maps. The room's creator can't leave. */
export function leaveRoom(roomId: string): Promise<void> {
  return postJSON<void>(`/api/rooms/${encodeURIComponent(roomId)}/leave`, {});
}
