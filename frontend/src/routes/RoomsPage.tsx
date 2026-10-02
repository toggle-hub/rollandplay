import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, DoorOpen, Plus, Sword } from "@phosphor-icons/react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, apiFetch, postJSON } from "../api/client";
import type { InvitePreview, Room, RoomJoin, RuleBook, Sheet } from "../api/types";
import { useSession } from "../auth/SessionContext";

export function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [books, setBooks] = useState<RuleBook[]>([]);
  const [name, setName] = useState("");
  const [bookId, setBookId] = useState("");
  const [invite, setInvite] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [characters, setCharacters] = useState<Sheet[]>([]);
  const [character, setCharacter] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
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
  async function create(e: FormEvent) {
    e.preventDefault();
    setCreateError("");
    setBusy("create");
    try {
      const room = await postJSON<Room>("/api/rooms", { name: name.trim(), is_public: true, rule_book_id: bookId });
      nav(`/rooms/${room.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the room.");
    } finally {
      setBusy(null);
    }
  }
  /** Shows the room and its rule book before joining, plus the player's matching characters. */
  async function lookup(e: FormEvent) {
    e.preventDefault();
    setJoinError("");
    setBusy("join");
    try {
      const [found, sheets] = await Promise.all([apiFetch<InvitePreview>(`/api/invites/${encodeURIComponent(invite.trim())}`), apiFetch<Sheet[]>("/api/sheets")]);
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
      <header className="max-w-5xl">
        <p className="eyebrow">The gathering place</p>
        <h1 className="page-heading">Your next adventure starts here.</h1>
        <p className="page-description">Bring your party together. Pick up a story, start a new one, or take a seat at a friend’s table.</p>
      </header>
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
              <p className="text-muted mx-auto mt-3 max-w-sm text-sm leading-relaxed">No rooms yet. Create your first table or use an invite code to join your party.</p>
            </div>
          ) : (
            <div className="grid grid-flow-dense gap-3">
              {rooms.map((room) => (
                <Link className="group flex min-w-0 items-center justify-between gap-4 rounded-xl border border-[var(--paper)]/10 p-5 transition-colors hover:border-[var(--accent)]/60 hover:bg-[var(--paper)]/5" key={room.id} to={`/rooms/${room.id}`}>
                  <div className="min-w-0"><h3 className="break-words text-xl">{room.name}</h3><p className="text-muted mt-2 break-words text-xs">Rule book <span className="ml-2 text-[var(--lavender)]">{room.rule_book.name}</span></p><p className="text-muted mt-1 break-all text-xs">Invite code <span className="ml-2 font-mono text-[var(--paper)]">{room.invite_code}</span></p></div>
                  <ArrowRight size={22} aria-hidden="true" className="shrink-0 text-[var(--accent)] transition-transform group-hover:translate-x-1" />
                </Link>
              ))}
            </div>
          )}
        </section>
        <div className="space-y-6">
          <form className="card space-y-4" onSubmit={create}>
            <h2 className="flex items-center gap-3 text-xl"><Plus size={22} className="text-[var(--accent)]" aria-hidden="true" />Set your own table</h2>
            <p className="text-muted text-sm">A new room, a blank map, a world of possibilities.</p>
            <label className="field-label" htmlFor="room-name">Room name</label>
            <input id="room-name" className="w-full" required value={name} onChange={(e) => setName(e.target.value)} placeholder="The Thursday campaign" />
            <label className="field-label" htmlFor="room-rule-book">Rule book</label>
            <select id="room-rule-book" className="w-full" required value={bookId} onChange={(e) => setBookId(e.target.value)} aria-describedby="room-rule-book-help">
              {books.length === 0 && <option value="">No rule books available</option>}
              {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
            </select>
            <p id="room-rule-book-help" className="text-muted text-xs">Your invite carries this rule book. Players without a matching character are asked to create one before they take a seat.</p>
            {createError && <p role="alert" className="text-sm text-[var(--pink)]">{createError}</p>}
            <button className="btn w-full" disabled={busy !== null || !name.trim() || !bookId}>{busy === "create" ? "Creating…" : "Create room"}<ArrowRight size={18} aria-hidden="true" /></button>
          </form>
          <form className="card space-y-4" onSubmit={preview ? join : lookup}>
            <h2 className="text-xl">Already have an invite?</h2>
            <label className="field-label" htmlFor="room-invite">Invite code</label>
            <input id="room-invite" className="w-full" required readOnly={!!preview} value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Enter your party’s code" />
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
