import { useEffect, useState } from "react";
import { Scroll } from "@phosphor-icons/react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, patchJSON, postJSON } from "../api/client";
import type { CharacterCreation, Room, RuleBook, Sheet } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { CharacterCreator } from "../components/CharacterCreator";
import { useToast } from "../components/Toast";

export function SheetsPage() {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [books, setBooks] = useState<RuleBook[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [renameError, setRenameError] = useState<{ id: string; message: string } | null>(null);
  const toast = useToast();
  const [params] = useSearchParams();
  const roomId = params.get("room");
  const { session } = useSession();
  const userId = session.status === "authenticated" ? session.user.id : "";
  const nav = useNavigate();
  async function load() {
    const [nextSheets, nextBooks] = await Promise.all([apiFetch<Sheet[]>("/api/sheets"), apiFetch<RuleBook[]>("/api/rule-books")]);
    setSheets(nextSheets ?? []); setBooks(nextBooks ?? []);
  }
  function reportPageError(message: string) {
    setError(message);
    toast({ kind: "error", message });
  }
  async function loadRoom(id: string) {
    try { setRoom(await apiFetch<Room>(`/api/rooms/${id}`)); }
    catch (err) { reportPageError(`Could not open the room invite: ${err instanceof Error ? err.message : "unknown error"}`); }
  }
  useEffect(() => {
    setRoom(null); setLoading(true);
    Promise.all([load(), roomId ? loadRoom(roomId) : null]).catch((err: Error) => reportPageError(err.message)).finally(() => setLoading(false));
  }, [roomId]);
  async function create(name: string, bookId: string, data: Record<string, unknown>, creation: CharacterCreation) {
    const sheet = await postJSON<Sheet>("/api/sheets", { name, rule_book_id: bookId, data, creation });
    setSheets((current) => [sheet, ...current]);
    if (!room) {
      toast({ kind: "success", message: `“${sheet.name}” created. Your character is ready to join a room.` });
      return;
    }
    try {
      await patchJSON(`/api/rooms/${room.id}/members/${userId}`, { sheet_id: sheet.id });
      toast({ kind: "success", message: `“${sheet.name}” created and chosen for ${room.name}.` });
      nav(`/rooms/${room.id}`);
    } catch (err) {
      reportPageError(`“${sheet.name}” was created, but could not be chosen for ${room.name}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }
  async function rename(id: string, value: string) {
    setRenameError(null);
    try { await patchJSON(`/api/sheets/${id}`, { name: value }); await load(); }
    catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the name.";
      setRenameError({ id, message });
      toast({ kind: "error", message });
    }
  }
  return <div className="workspace-page">
    <header><p className="eyebrow">A character worth becoming</p><h1 className="page-heading max-w-5xl">Character sheets</h1><p className="page-description">Give your heroes a name, a set of strengths, and a place in the story. Start with your rule book’s defaults and make them your own.</p></header>
    {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
    {room && <section className="card space-y-2 border-[var(--accent)]/50" aria-labelledby="room-character-heading">
      <p className="eyebrow">Your seat is waiting</p>
      <h2 id="room-character-heading" className="text-2xl">Create a character for {room.name}</h2>
      <p className="text-muted text-sm leading-relaxed">This room plays with <strong className="text-[var(--paper)]">{room.rule_book.name}</strong>. Create a character for it and you’ll return to the table with that character chosen.</p>
      <Link className="inline-block text-sm text-[var(--accent)] underline underline-offset-4" to={`/rooms/${room.id}`}>Enter the room without a character</Link>
    </section>}
    <div className="grid grid-flow-dense items-start gap-6 xl:grid-cols-[minmax(260px,0.7fr)_minmax(0,1.3fr)]">
      <div className="min-w-0 xl:col-start-2 xl:row-start-1">
        {loading ? <p role="status" className="card text-muted">Loading character defaults…</p> : <CharacterCreator key={room?.id ?? ""} books={books} lockedBookId={room?.rule_book.id} onCreate={create} />}
      </div>
      <section className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
        <h2 className="text-xl">Your characters</h2>
        {loading ? <p className="text-muted">Gathering character sheets…</p> : sheets.length === 0 ? <div className="card empty-state py-16">
          <Scroll size={44} weight="thin" className="mx-auto mb-5 text-[var(--accent)]" aria-hidden="true" />
          <h3 className="text-xl">Every legend begins with a name.</h3>
          <p className="text-muted mx-auto mt-3 max-w-sm text-sm">Choose a rule book and create a character to bring to your next room.</p>
        </div> : <div className="grid grid-flow-dense gap-4 md:grid-cols-2 xl:grid-cols-1">{sheets.map((sheet) => <article className="card min-w-0 space-y-4" key={sheet.id}>
          {renameError?.id === sheet.id && <p role="alert" className="text-sm text-[var(--pink)]">{renameError.message}</p>}
          <label className="field-label block" htmlFor={`sheet-${sheet.id}`}>Character name</label>
          <input id={`sheet-${sheet.id}`} className="w-full" defaultValue={sheet.name} onBlur={(e) => { if (e.target.value !== sheet.name) void rename(sheet.id, e.target.value); }} />
          <p className="text-muted text-xs">Name saves when you leave the field.</p>
          <p className="text-sm text-[var(--accent)]">{books.find((item) => item.id === sheet.rule_book_id)?.name ?? "Linked rule book"}</p>
          {typeof sheet.data.class === "string" && <p className="text-sm text-[var(--lavender)]">{sheet.data.class}</p>}
          <details><summary className="cursor-pointer text-sm text-[var(--lavender)]">View character data (JSON)</summary><pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-[var(--paper)]/10 bg-[var(--input)]/20 p-4 text-xs leading-relaxed">{JSON.stringify(sheet.data, null, 2)}</pre></details>
        </article>)}</div>}
      </section>
    </div>
  </div>;
}
