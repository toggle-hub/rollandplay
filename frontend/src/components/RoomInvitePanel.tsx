import { useEffect, useState, type FormEvent } from "react";
import { EnvelopeSimple, MagnifyingGlass } from "@phosphor-icons/react";
import { apiFetch, deleteJSON, postJSON } from "../api/client";
import type { InviteCandidate, SentRoomInvitation } from "../api/types";
import { useNotificationEvents } from "../notifications/NotificationsContext";
import { useThrottledValue } from "../lib/useThrottledValue";
import { PlayerName, playerLabel } from "./PlayerName";
import { useToast } from "./Toast";

/** Searches start at this many characters, matching the server. */
export const minInviteQuery = 2;
/** Typing searches at most this often. */
export const inviteSearchThrottleMs = 300;

/**
 * Game-master card: find players by username, invite them, and withdraw pending invitations.
 * `memberCount` changes when someone joins, which refreshes the pending list and the results.
 */
export function RoomInvitePanel({ roomId, memberCount }: { roomId: string; memberCount: number }) {
  const [query, setQuery] = useState("");
  const search = useThrottledValue(query.trim(), inviteSearchThrottleMs);
  // Results with the query they answer; until they answer the typed query, the panel shows a search in progress.
  const [results, setResults] = useState<{ query: string; items: InviteCandidate[] }>({ query: "", items: [] });
  const [pending, setPending] = useState<SentRoomInvitation[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const toast = useToast();
  const candidates = results.items;

  useEffect(() => {
    apiFetch<SentRoomInvitation[]>(`/api/rooms/${roomId}/invitations`)
      .then((items) => setPending(items ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load invitations."));
  }, [roomId, memberCount, revision]);
  // Accepted and declined invitations leave the lists as soon as the player answers.
  useNotificationEvents((note) => {
    if (note.kind.startsWith("room_invitation.") && note.room?.id === roomId) setRevision((current) => current + 1);
  });

  useEffect(() => {
    if (search.length < minInviteQuery) {
      setResults({ query: search, items: [] });
      return;
    }
    // A newer search aborts this one, so an older answer never replaces a newer one.
    const controller = new AbortController();
    apiFetch<InviteCandidate[]>(`/api/rooms/${roomId}/invite-candidates?q=${encodeURIComponent(search)}`, { signal: controller.signal })
      .then((found) => setResults({ query: search, items: found ?? [] }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setResults({ query: search, items: [] });
        setError(err instanceof Error ? err.message : "Could not search for players.");
      });
    return () => controller.abort();
  }, [roomId, search, memberCount, revision]);

  async function act(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the invitation.");
    } finally {
      setBusy(null);
    }
  }

  const markInvited = (userId: string, invited: boolean) =>
    setResults((current) => ({ ...current, items: current.items.map((item) => item.id === userId ? { ...item, invited } : item) }));

  const invite = (candidate: InviteCandidate) => act(candidate.id, async () => {
    const created = await postJSON<SentRoomInvitation>(`/api/rooms/${roomId}/invitations`, { username: candidate.username });
    setPending((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    markInvited(candidate.id, true);
    toast({ kind: "success", message: `Invitation sent to ${playerLabel(candidate)}.` });
  });

  const withdraw = (invitation: SentRoomInvitation) => act(invitation.id, async () => {
    await deleteJSON(`/api/room-invitations/${invitation.id}`);
    setPending((current) => current.filter((item) => item.id !== invitation.id));
    markInvited(invitation.invitee.id, false);
  });

  // Enter invites the player whose username was typed exactly.
  function submit(event: FormEvent) {
    event.preventDefault();
    const exact = candidates.find((candidate) => candidate.username.toLowerCase() === query.trim().toLowerCase());
    if (exact && !exact.invited && busy === null) void invite(exact);
  }

  const typed = query.trim().length >= minInviteQuery;
  return <section className="card space-y-4" aria-labelledby="room-invite-heading">
    <h2 id="room-invite-heading" className="flex items-center gap-2 text-xl"><EnvelopeSimple size={22} className="text-[var(--accent)]" aria-hidden="true" />Invite players</h2>
    <form className="space-y-2" role="search" onSubmit={submit}>
      <label className="field-label" htmlFor="room-invite-username">Username</label>
      <div className="relative">
        <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        <input id="room-invite-username" className="w-full pl-9!" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by username" aria-describedby="room-invite-help" />
      </div>
      <p id="room-invite-help" className="text-muted text-xs">Type at least {minInviteQuery} letters. Invited players join from their notifications, without the code or password.</p>
    </form>
    {error && <p role="alert" className="text-sm text-[var(--pink)]">{error}</p>}
    <div aria-live="polite" className="space-y-2">
      {typed && (results.query !== query.trim()
        ? <p className="text-muted text-sm">Searching…</p>
        : candidates.length === 0
          ? <p className="text-muted text-sm">No players match “{query.trim()}”.</p>
          : <ul className="space-y-2" aria-label="Matching players">{candidates.map((candidate) => <li key={candidate.id} className="flex items-center justify-between gap-3 text-sm">
            <PlayerName className="min-w-0 break-words" player={candidate} />
            {candidate.invited
              ? <span className="shrink-0 text-xs text-[var(--muted)]">Invited</span>
              : <button type="button" className="btn shrink-0 min-h-9! px-3! py-1.5!" disabled={busy !== null} aria-label={`Invite ${playerLabel(candidate)}`} onClick={() => void invite(candidate)}>{busy === candidate.id ? "Inviting…" : "Invite"}</button>}
          </li>)}</ul>)}
    </div>
    {pending.length > 0 && <div className="space-y-2 border-t border-[var(--paper)]/10 pt-3">
      <h3 className="text-sm text-[var(--lavender)]">Waiting for an answer</h3>
      <ul className="space-y-2">{pending.map((invitation) => <li key={invitation.id} className="flex items-center justify-between gap-3 text-sm">
        <PlayerName className="min-w-0 break-words" player={invitation.invitee} />
        <button type="button" className="btn-secondary shrink-0 min-h-9! px-3! py-1.5!" disabled={busy !== null} aria-label={`Withdraw invitation for ${playerLabel(invitation.invitee)}`} onClick={() => void withdraw(invitation)}>{busy === invitation.id ? "Withdrawing…" : "Withdraw"}</button>
      </li>)}</ul>
    </div>}
  </section>;
}
