import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, DoorOpen, UserPlus } from "@phosphor-icons/react";
import { apiFetch, deleteJSON, patchJSON, postJSON } from "../api/client";
import type { Friend, RoomInvitation, RoomJoin, Sheet } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { useNotifications } from "../notifications/NotificationsContext";
import { PlayerName } from "./PlayerName";

/** Header bell: incoming friend requests and room invitations, answerable in place. */
export function NotificationsMenu() {
  const { friend_requests: requests, room_invitations: invitations, refresh, announce } = useNotifications();
  const { session } = useSession();
  const userId = session.status === "authenticated" ? session.user.id : "";
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // An invitation waiting for the player to choose which of their characters joins.
  const [picking, setPicking] = useState<{ invitationId: string; options: Sheet[]; chosen: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const count = requests.length + invitations.length;

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => { if (!open) setPicking(null); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function act(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not answer that. Please try again.");
    } finally {
      setBusy(null);
      void refresh().catch(() => {});
    }
  }

  const answerFriend = (friend: Friend, accept: boolean) => act(friend.id, async () => {
    if (accept) await patchJSON(`/api/friends/${friend.id}`, { status: "accepted" });
    else await deleteJSON(`/api/friends/${friend.id}`);
    announce({ kind: "friend.changed" });
  });

  async function acceptInvitation(invitation: RoomInvitation, sheetId: string | undefined) {
    const joined = await postJSON<RoomJoin>(`/api/room-invitations/${invitation.id}/accept`, sheetId ? { sheet_id: sheetId } : {});
    setOpen(false);
    navigate(joined.is_dm || joined.sheet_id ? `/rooms/${joined.room_id}` : `/sheets?room=${encodeURIComponent(joined.room_id)}`);
  }

  // Like joining with a code: one matching character is chosen, several ask which one, none sends
  // the player to create one.
  const join = (invitation: RoomInvitation) => act(invitation.id, async () => {
    const matching = ((await apiFetch<Sheet[]>("/api/sheets")) ?? []).filter((sheet) => sheet.user_id === userId && sheet.rule_book_id === invitation.room.rule_book.id);
    if (matching.length > 1) setPicking({ invitationId: invitation.id, options: matching, chosen: matching[0].id });
    else await acceptInvitation(invitation, matching[0]?.id);
  });

  const joinAs = (invitation: RoomInvitation, sheetId: string) => act(invitation.id, () => acceptInvitation(invitation, sheetId));

  const decline = (invitation: RoomInvitation) => act(invitation.id, () => deleteJSON(`/api/room-invitations/${invitation.id}`));

  // The panel is placed against the nearest positioned ancestor: the header's right-hand controls.
  return <div ref={rootRef}>
    <button ref={buttonRef} type="button" className="btn-secondary relative px-3!" aria-label={count ? `Notifications, ${count} waiting` : "Notifications"} aria-expanded={open} aria-controls="notifications-panel" onClick={() => setOpen(!open)}>
      <Bell size={20} aria-hidden="true" weight={count ? "fill" : "regular"} />
      {count > 0 && <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-[var(--pink)] px-1 text-xs font-semibold leading-5 text-[var(--ink)]">{count > 9 ? "9+" : count}</span>}
    </button>
    {open && <section id="notifications-panel" aria-label="Notifications" className="card absolute right-0 top-full z-40 mt-2 w-[min(380px,calc(100vw-40px))] space-y-4 p-4! shadow-xl">
      {error && <p role="alert" className="text-sm text-[var(--pink)]">{error}</p>}
      {count === 0 && <p className="text-muted text-sm">You’re all caught up. New friend requests and room invitations show up here.</p>}
      {invitations.length > 0 && <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm text-[var(--lavender)]"><DoorOpen size={18} aria-hidden="true" />Room invitations</h2>
        <ul className="space-y-2">{invitations.map((invitation) => <li key={invitation.id} className="space-y-2 border-t border-[var(--paper)]/10 pt-2 text-sm">
          <p className="break-words"><PlayerName player={invitation.inviter} /> invited you to <strong className="font-medium text-[var(--paper)]">{invitation.room.name}</strong></p>
          <p className="text-muted text-xs">Plays with {invitation.room.rule_book.name}</p>
          {picking?.invitationId === invitation.id ? <div className="space-y-2">
            <label className="field-label block" htmlFor={`invitation-character-${invitation.id}`}>Which character joins?</label>
            <select id={`invitation-character-${invitation.id}`} className="w-full" autoFocus value={picking.chosen} onChange={(event) => setPicking({ ...picking, chosen: event.target.value })}>
              {picking.options.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}
            </select>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn min-h-9! px-3! py-1.5!" disabled={busy !== null} onClick={() => void joinAs(invitation, picking.chosen)}>{busy === invitation.id ? "Joining…" : "Join room"}</button>
              <button type="button" className="btn-secondary min-h-9! px-3! py-1.5!" disabled={busy !== null} onClick={() => setPicking(null)}>Back</button>
            </div>
          </div> : <div className="flex flex-wrap gap-2">
            <button type="button" className="btn min-h-9! px-3! py-1.5!" disabled={busy !== null} onClick={() => void join(invitation)}>{busy === invitation.id ? "Working…" : "Join room"}</button>
            <button type="button" className="btn-secondary min-h-9! px-3! py-1.5!" disabled={busy !== null} onClick={() => void decline(invitation)}>Decline</button>
          </div>}
        </li>)}</ul>
      </div>}
      {requests.length > 0 && <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm text-[var(--lavender)]"><UserPlus size={18} aria-hidden="true" />Friend requests</h2>
        <ul className="space-y-2">{requests.map((friend) => <li key={friend.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--paper)]/10 pt-2 text-sm">
          <PlayerName className="min-w-0 break-words" player={friend.other_user} fallback={friend.id} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn min-h-9! px-3! py-1.5!" disabled={busy !== null} onClick={() => void answerFriend(friend, true)}>{busy === friend.id ? "Working…" : "Accept"}</button>
            <button type="button" className="btn-secondary min-h-9! px-3! py-1.5!" disabled={busy !== null} onClick={() => void answerFriend(friend, false)}>Decline</button>
          </div>
        </li>)}</ul>
      </div>}
      <Link className="block text-sm text-[var(--accent)]" to="/friends">Manage friends</Link>
    </section>}
  </div>;
}
