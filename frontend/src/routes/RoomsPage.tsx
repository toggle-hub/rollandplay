import { FormEvent, useEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, Crown, DoorOpen, LinkSimple, Plus, SignOut, Sword, Trash, UserCircle } from "@phosphor-icons/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, apiFetch, postJSON } from "../api/client";
import { copyInviteLink, deleteRoom, inviteLink, leaveRoom } from "../api/rooms";
import type { InvitePreview, Room, RoomJoin, RuleBook, Sheet } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { useToast } from "../components/Toast";

/** Scrolls a form field into view and focuses it; the forms sit below the room list on narrow screens. */
function focusField(ref: RefObject<HTMLInputElement | null>) {
  ref.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  ref.current?.focus({ preventScroll: true });
}

export function RoomsPage() {
  const location = useLocation();
  // Invite links (/join/<code>) arrive with the code in the navigation state: Find room starts filled in and looked up.
  const [linkedInvite] = useState(() => {
    const state: unknown = location.state;
    return state && typeof state === "object" && "invite" in state && typeof state.invite === "string" ? state.invite.trim() : "";
  });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [books, setBooks] = useState<RuleBook[]>([]);
  const [name, setName] = useState("");
  const [bookId, setBookId] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [roomPassword, setRoomPassword] = useState("");
  const [invite, setInvite] = useState(linkedInvite);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [characters, setCharacters] = useState<Sheet[]>([]);
  const [character, setCharacter] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const roomNameRef = useRef<HTMLInputElement>(null);
  const inviteRef = useRef<HTMLInputElement>(null);
  const { session } = useSession();
  const userId = session.status === "authenticated" ? session.user.id : "";
  const nav = useNavigate();
  useEffect(() => {
    apiFetch<Room[]>("/api/rooms")
      .then((items) => setRooms(items ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    apiFetch<RuleBook[]>("/api/rule-books")
      .then((items) => {
        setBooks(items ?? []);
        setBookId((current) => current || items?.[0]?.id || "");
      })
      .catch((err: Error) => setCreateError(`Could not load rule books: ${err.message}`));
  }, []);
  useEffect(() => {
    if (!linkedInvite) return;
    focusField(inviteRef);
    void findInvite(linkedInvite);
  }, [linkedInvite]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setCreateError("");
    setBusy("create");
    try {
      const room = await postJSON<Room>("/api/rooms", { name: name.trim(), is_public: !isPrivate, password: roomPassword, rule_book_id: bookId });
      nav(`/rooms/${room.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the room.");
    } finally {
      setBusy(null);
    }
  }
  /** Shows the room and its rule book before joining, plus the player's matching characters. */
  async function findInvite(code: string) {
    setJoinError("");
    setBusy("join");
    try {
      const [found, sheets] = await Promise.all([apiFetch<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`), apiFetch<Sheet[]>("/api/sheets")]);
      const matching = found.member?.is_dm ? [] : (sheets ?? []).filter((sheet) => sheet.user_id === userId && sheet.rule_book_id === found.rule_book.id);
      setPreview(found);
      setCharacters(matching);
      setCharacter(matching.find((sheet) => sheet.id === found.member?.sheet_id)?.id ?? matching[0]?.id ?? "");
    } catch (err) {
      setJoinError(err instanceof ApiError && err.status === 404 ? "No room matches that invite code." : err instanceof Error ? err.message : "Could not find the room.");
    } finally {
      setBusy(null);
    }
  }
  async function join(e: FormEvent) {
    e.preventDefault();
    setJoinError("");
    setBusy("join");
    try {
      const joined = await postJSON<RoomJoin>("/api/rooms/join", { invite_code: invite.trim(), password, sheet_id: character || undefined });
      // Players without a character for the room's rule book create one, then return to the table.
      nav(joined.is_dm || joined.sheet_id ? `/rooms/${joined.room_id}` : `/sheets?room=${encodeURIComponent(joined.room_id)}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join the room.");
    } finally {
      setBusy(null);
    }
  }
  function changeInvite() {
    setPreview(null);
    setCharacters([]);
    setCharacter("");
    setPassword("");
    setJoinError("");
  }
  return (
    <div className="workspace-page">
      <header><h1 className="page-heading">Rooms</h1></header>
      <div className="grid grid-flow-dense items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <section className="card min-w-0">
          <div className="mb-6 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-medium">Your rooms</h2>
            <Sword size={24} className="text-[var(--accent)]" aria-hidden="true" />
          </div>
          {loading ? <p role="status" className="text-muted py-8">Finding your tables…</p> : error ? <p role="alert" className="text-[var(--pink)]">Could not load rooms: {error}</p> : rooms.length === 0 ? (
            <div className="empty-state py-14">
              <DoorOpen size={44} weight="thin" className="mx-auto mb-5 text-[var(--accent)]" aria-hidden="true" />
              <h3 className="text-xl">A seat is waiting for you.</h3>
              <p className="text-muted mx-auto mt-3 max-w-sm text-sm leading-relaxed">No rooms yet. Start your own table, or join your party with an invite link or code.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button type="button" className="btn" onClick={() => focusField(roomNameRef)}><Plus size={18} className="m-0!" aria-hidden="true" />Create a room</button>
                <button type="button" className="btn-secondary" onClick={() => focusField(inviteRef)}><DoorOpen size={18} className="m-0!" aria-hidden="true" />Join with an invite</button>
              </div>
            </div>
          ) : (
            <ul className="grid grid-flow-dense gap-3" aria-label="Your rooms">
              {rooms.map((room) => <RoomCard key={room.id} room={room} userId={userId} onGone={(id) => setRooms((current) => current.filter((item) => item.id !== id))} />)}
            </ul>
          )}
        </section>
        <div className="space-y-6">
          <form className="card space-y-4" onSubmit={create}>
            <h2 className="flex items-center gap-3 text-xl"><Plus size={22} className="text-[var(--accent)]" aria-hidden="true" />Set your own table</h2>
            <label className="field-label" htmlFor="room-name">Room name</label>
            <input ref={roomNameRef} id="room-name" className="w-full" required value={name} onChange={(e) => setName(e.target.value)} placeholder="The Thursday campaign" />
            <label className="field-label" htmlFor="room-rule-book">Rule book</label>
            <select id="room-rule-book" className="w-full" required value={bookId} onChange={(e) => setBookId(e.target.value)} aria-describedby="room-rule-book-help">
              {books.length === 0 && <option value="">No rule books available</option>}
              {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
            </select>
            <p id="room-rule-book-help" className="text-muted text-xs">Your invite carries this rule book. Players without a matching character are asked to create one before they take a seat.</p>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 shrink-0" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} aria-describedby="room-private-help" />
              <span>Private (invite only)<span id="room-private-help" className="text-muted mt-1 block text-xs">Players join with your invite link or code, or an invitation from the room. A public room can be listed for anyone signed in.</span></span>
            </label>
            <label className="field-label" htmlFor="new-room-password">Password (optional)</label>
            <input id="new-room-password" type="password" autoComplete="new-password" className="w-full" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} aria-describedby="new-room-password-help" />
            <p id="new-room-password-help" className="text-muted text-xs">Players joining with the link or code must enter it. Players you invite from the room skip it.</p>
            {createError && <p role="alert" className="text-sm text-[var(--pink)]">{createError}</p>}
            <button className="btn w-full" disabled={busy !== null || !name.trim() || !bookId}>{busy === "create" ? "Creating…" : "Create room"}<ArrowRight size={18} aria-hidden="true" /></button>
          </form>
          <form className="card space-y-4" onSubmit={preview ? join : (e) => { e.preventDefault(); void findInvite(invite.trim()); }}>
            <h2 className="text-xl">Already have an invite?</h2>
            <label className="field-label" htmlFor="room-invite">Invite code</label>
            <input ref={inviteRef} id="room-invite" className="w-full" required readOnly={!!preview} value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Enter your party’s code" />
            {preview ? <>
              <section className="space-y-1 rounded-lg border border-[var(--line)] p-4" aria-label="Invite details">
                <h3 className="break-words text-lg">{preview.name}</h3>
                <p className="text-muted text-sm">Plays with <strong className="text-[var(--lavender)]">{preview.rule_book.name}</strong></p>
              </section>
              {preview.member?.is_dm ? <p className="text-muted text-sm">You’re the game master at this table.</p>
                : characters.length === 0 ? <p className="text-sm text-[var(--lavender)]">You don’t have a {preview.rule_book.name} character yet. After joining, you’ll create one and return to the table with it chosen.</p>
                : <>
                  <label className="field-label" htmlFor="room-character">Your character</label>
                  <select id="room-character" className="w-full" required value={character} onChange={(e) => setCharacter(e.target.value)}>
                    {characters.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}
                  </select>
                </>}
              {preview.requires_password && <>
                <label className="field-label" htmlFor="room-password">Password</label>
                <input id="room-password" type="password" autoComplete="current-password" className="w-full" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Room password" />
              </>}
              {joinError && <p role="alert" className="text-sm text-[var(--pink)]">{joinError}</p>}
              <button className="btn w-full" disabled={busy !== null}>{busy === "join" ? "Joining…" : !preview.member?.is_dm && characters.length === 0 ? "Join and create a character" : "Join room"}<DoorOpen size={18} aria-hidden="true" /></button>
              <button type="button" className="btn-secondary w-full" disabled={busy !== null} onClick={changeInvite}>Use a different code</button>
            </> : <>
              {joinError && <p role="alert" className="text-sm text-[var(--pink)]">{joinError}</p>}
              <button className="btn-secondary w-full" disabled={busy !== null || !invite.trim()}>{busy === "join" ? "Finding…" : "Find room"}<ArrowRight size={18} aria-hidden="true" /></button>
            </>}
          </form>
        </div>
      </div>
    </div>
  );
}

const badge = "inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--lavender)]";
const smallButton = "min-h-9! px-3! py-1.5!";

/** A room in the list: your seat at it, who else plays, and its invite link. The creator deletes it, everyone else leaves it. */
function RoomCard({ room, userId, onGone }: { room: Room; userId: string; onGone: (roomId: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const seat = room.membership;
  const isOwner = room.owner_id === userId;
  const players = room.player_count ?? 0;

  async function copy() {
    try {
      await copyInviteLink(room.invite_code);
      toast({ kind: "success", message: `Invite link to ${room.name} copied.` });
    } catch {
      toast({ kind: "error", message: `Couldn’t copy the link. Share this instead: ${inviteLink(room.invite_code)}` });
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await (isOwner ? deleteRoom(room.id) : leaveRoom(room.id));
      onGone(room.id);
      toast({ kind: "success", message: isOwner ? `${room.name} was deleted.` : `You left ${room.name}.` });
    } catch (err) {
      setBusy(false);
      toast({ kind: "error", message: err instanceof Error ? err.message : isOwner ? "Could not delete the room." : "Could not leave the room." });
    }
  }

  // The room name's link covers the whole card; the buttons sit above it.
  return <li className="relative rounded-xl border border-[var(--paper)]/10 p-5 transition-colors focus-within:border-[var(--accent)]/60 hover:border-[var(--accent)]/60 hover:bg-[var(--paper)]/5">
    <div className="flex min-w-0 items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="break-words text-xl"><Link className="after:absolute after:inset-0 after:rounded-xl" to={`/rooms/${room.id}`}>{room.name}</Link></h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {seat && <span className={badge}>{seat.is_dm ? <><Crown size={14} aria-hidden="true" />Game master</> : <><UserCircle size={14} aria-hidden="true" />{seat.sheet_name ? `Playing as ${seat.sheet_name}` : "No character chosen"}</>}</span>}
          <span className={badge}>{players === 0 ? "No players yet" : players === 1 ? "1 player" : `${players} players`}</span>
          <span className={badge}>{room.is_public ? "Public" : "Private"}{room.requires_password ? " · password" : ""}</span>
        </div>
        <p className="text-muted mt-3 break-words text-xs">Rule book <span className="ml-2 text-[var(--lavender)]">{room.rule_book.name}</span></p>
        <p className="text-muted mt-1 break-all text-xs">Invite code <span className="ml-2 font-mono text-[var(--paper)]">{room.invite_code}</span></p>
      </div>
      <ArrowRight size={22} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
    </div>
    {confirming ? <div role="group" aria-label={isOwner ? `Delete ${room.name}` : `Leave ${room.name}`} className="relative z-10 mt-4 space-y-3 rounded-lg border border-[var(--pink)]/50 bg-[var(--surface)] p-4">
      <p className="text-sm">{isOwner
        ? `Delete ${room.name} for everyone? Its chat, tokens, checks and invitations are removed for good. Your maps, characters and rule books stay.`
        : `Leave ${room.name}? Your character’s token leaves the table. You can come back with the invite link.`}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`btn ${smallButton}`} disabled={busy} onClick={() => void remove()}>{isOwner ? busy ? "Deleting…" : "Delete room" : busy ? "Leaving…" : "Leave room"}</button>
        <button type="button" className={`btn-secondary ${smallButton}`} disabled={busy} autoFocus onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div> : <div className="relative z-10 mt-4 flex flex-wrap gap-2">
      <button type="button" className={`btn-secondary ${smallButton}`} onClick={() => void copy()}><LinkSimple size={16} aria-hidden="true" />Copy invite link</button>
      {seat && <button type="button" className={`btn-secondary ${smallButton}`} aria-label={isOwner ? `Delete ${room.name}` : `Leave ${room.name}`} onClick={() => setConfirming(true)}>
        {isOwner ? <><Trash size={16} aria-hidden="true" />Delete room</> : <><SignOut size={16} aria-hidden="true" />Leave room</>}
      </button>}
    </div>}
  </li>;
}
