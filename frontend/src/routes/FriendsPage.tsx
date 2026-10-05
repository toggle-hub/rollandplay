import { FormEvent, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { UserPlus, UsersThree } from "@phosphor-icons/react";
import { PlayerName } from "../components/PlayerName";
import { apiFetch, deleteJSON, patchJSON, postJSON } from "../api/client";
import type { Friend } from "../api/types";
import { useNotificationEvents, useNotifications } from "../notifications/NotificationsContext";

type FriendBuckets = { pending_inbound: Friend[]; pending_outbound: Friend[]; accepted: Friend[]; blocked: Friend[] };
const empty: FriendBuckets = { pending_inbound: [], pending_outbound: [], accepted: [], blocked: [] };
export function FriendsPage() {
  const [friends, setFriends] = useState<FriendBuckets>(empty);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = async () => {
    const result = await apiFetch<FriendBuckets>("/api/friends");
    setFriends({ pending_inbound: result.pending_inbound ?? [], pending_outbound: result.pending_outbound ?? [], accepted: result.accepted ?? [], blocked: result.blocked ?? [] });
  };
  useEffect(() => { load().catch((err: Error) => setError(err.message)).finally(() => setLoading(false)); }, []);
  // Requests sent, answered or withdrawn elsewhere show up without a reload.
  useNotificationEvents((note) => { if (note.kind.startsWith("friend.")) load().catch(() => {}); });
  const { refresh: refreshNotifications } = useNotifications();
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Could not update your friends."); } finally { setBusy(false); refreshNotifications().catch(() => {}); }
  }
  function request(e: FormEvent) {
    e.preventDefault();
    void act(async () => { await postJSON("/api/friends", { email: email.trim() }); setEmail(""); await load(); setNotice("Friend request sent."); });
  }
  function accept(id: string) {
    void act(async () => {
      await patchJSON(`/api/friends/${id}`, { status: "accepted" });
      setFriends((current) => {
        const item = current.pending_inbound.find((friend) => friend.id === id);
        return item ? { ...current, pending_inbound: current.pending_inbound.filter((friend) => friend.id !== id), accepted: [{ ...item, status: "accepted" }, ...current.accepted] } : current;
      });
    });
  }
  function remove(id: string) { void act(async () => { await deleteJSON(`/api/friends/${id}`); await load(); }); }
  return (
    <div className="workspace-page">
      <header><p className="eyebrow">Better together</p><h1 className="page-heading">Your party, beyond the table.</h1><p className="page-description">Keep your fellow adventurers close and welcome someone new.</p></header>
      <form className="card space-y-4" onSubmit={request}>
        <h2 className="flex items-center gap-3 text-xl"><UserPlus size={24} className="text-[var(--accent)]" aria-hidden="true" />Add a friend</h2>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-lg"><label className="field-label mb-2 block" htmlFor="friend-email">Their email address</label><input id="friend-email" type="email" required className="w-full" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" /></div>
          <button className="btn shrink-0" disabled={busy}>{busy ? "Working…" : "Request friend"}</button>
        </div>
      </form>
      {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
      {notice && <p role="status" className="text-[var(--green)]">{notice}</p>}
      {loading ? <p role="status" className="text-muted">Gathering your party…</p> : <div className="grid grid-flow-dense gap-6 lg:grid-cols-2">
        <Bucket title="Your friends" description="People ready for the next adventure." emptyText="Your party starts with one invitation. Add a friend by email above." items={friends.accepted} action={(friend) => <button className="btn-secondary" disabled={busy} onClick={() => remove(friend.id)}>Remove</button>} />
        <Bucket title="Incoming requests" description="An invitation to share the story." emptyText="No incoming requests. New invitations will appear here." items={friends.pending_inbound} action={(friend) => <><button className="btn" disabled={busy} onClick={() => accept(friend.id)}>Accept</button><button className="btn-secondary" disabled={busy} onClick={() => void act(async () => { await patchJSON(`/api/friends/${friend.id}`, { status: "blocked" }); await load(); })}>Block</button></>} />
        <Bucket title="Sent requests" description="The invitations you’ve sent out." emptyText="No invitations waiting for a response." items={friends.pending_outbound} action={(friend) => <button className="btn-secondary" disabled={busy} onClick={() => remove(friend.id)}>Cancel</button>} />
        <Bucket title="Blocked" description="Manage who can connect with you." emptyText="You haven’t blocked anyone." items={friends.blocked} action={(friend) => <button className="btn-secondary" disabled={busy} onClick={() => remove(friend.id)}>Remove</button>} />
      </div>}
    </div>
  );
}
function Bucket({ title, description, emptyText, items, action }: { title: string; description: string; emptyText: string; items: Friend[]; action: (friend: Friend) => ReactNode }) {
  return <section className="card min-w-0"><h2 className="text-xl">{title}</h2><p className="text-muted mt-2 text-sm">{description}</p><div className="mt-6 space-y-3">{items.length === 0 ? <div className="empty-state flex items-center gap-3 text-left"><UsersThree size={24} className="shrink-0 text-[var(--muted)]" aria-hidden="true" /><p className="text-muted text-sm">{emptyText}</p></div> : items.map((friend) => <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--paper)]/10 py-4" key={friend.id}><PlayerName className="min-w-0 break-all text-sm" player={friend.other_user} fallback={friend.id} /><div className="flex flex-wrap gap-2">{action(friend)}</div></div>)}</div></section>;
}
