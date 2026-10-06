import { useEffect, useState } from "react";
import { Scroll } from "@phosphor-icons/react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, deleteJSON, patchJSON, postJSON } from "../api/client";
import type { ActionLists, CharacterCreation, Room, RuleBook, Sheet } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { CharacterCreator } from "../components/CharacterCreator";
import { CharacterSheetCard } from "../components/CharacterSheetCard";
import { useToast } from "../components/Toast";

export function SheetsPage() {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [books, setBooks] = useState<RuleBook[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
  async function loadRoom(id: string) {
    try { setRoom(await apiFetch<Room>(`/api/rooms/${id}`)); }
    catch (err) { setError(`Could not open the room invite: ${err instanceof Error ? err.message : "unknown error"}`); }
  }
  useEffect(() => {
    setRoom(null); setLoading(true);
    Promise.all([load(), roomId ? loadRoom(roomId) : null]).catch((err: Error) => setError(err.message)).finally(() => setLoading(false));
  }, [roomId]);
  function replace(saved: Sheet) {
    setSheets((current) => current.map((sheet) => sheet.id === saved.id ? saved : sheet));
  }
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
      setError(`“${sheet.name}” was created, but could not be chosen for ${room.name}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }
  async function rename(id: string, name: string) {
    replace(await patchJSON<Sheet>(`/api/sheets/${id}`, { name }));
  }
  async function saveData(id: string, data: Record<string, unknown>) {
    replace(await patchJSON<Sheet>(`/api/sheets/${id}`, { data }));
    toast({ kind: "success", message: "Character saved." });
  }
  async function saveLists(id: string, lists: ActionLists) {
    replace(await patchJSON<Sheet>(`/api/sheets/${id}/actions`, lists));
    toast({ kind: "success", message: "Attacks, spells and items saved." });
  }
  async function remove(sheet: Sheet) {
    await deleteJSON(`/api/sheets/${sheet.id}`);
    setSheets((current) => current.filter((item) => item.id !== sheet.id));
    toast({ kind: "success", message: `“${sheet.name}” deleted.` });
  }
  return <div className="workspace-page">
    <header><h1 className="text-3xl">Characters</h1></header>
    {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
    {room && <section className="card space-y-2 border-[var(--accent)]/50" aria-labelledby="room-character-heading">
      <h2 id="room-character-heading" className="text-2xl">Create a character for {room.name}</h2>
      <p className="text-muted text-sm leading-relaxed">This room plays with <strong className="text-[var(--paper)]">{room.rule_book.name}</strong>. Create a character for it and you’ll return to the table with that character chosen.</p>
      <Link className="inline-block text-sm text-[var(--accent)] underline underline-offset-4" to={`/rooms/${room.id}`}>Enter the room without a character</Link>
    </section>}
    <div className="grid grid-flow-dense items-start gap-6 xl:grid-cols-[minmax(260px,0.7fr)_minmax(0,1.3fr)]">
      <div className="min-w-0 xl:col-start-2 xl:row-start-1">
        {loading ? <p role="status" className="card text-muted">Loading character defaults…</p> : <CharacterCreator key={room?.id ?? ""} books={books} lockedBookId={room?.rule_book.id} onCreate={create} />}
      </div>
      <section className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1" aria-labelledby="your-characters-heading">
        <h2 id="your-characters-heading" className="text-xl">Your characters</h2>
        {loading ? <p className="text-muted">Gathering characters…</p> : sheets.length === 0 ? <div className="card empty-state py-16">
          <Scroll size={44} weight="thin" className="mx-auto mb-5 text-[var(--accent)]" aria-hidden="true" />
          <h3 className="text-xl">No characters yet</h3>
          <p className="text-muted mx-auto mt-3 max-w-sm text-sm">Create a character to bring to your next room.</p>
        </div> : <div className="grid grid-flow-dense gap-4 md:grid-cols-2 xl:grid-cols-1">{sheets.map((sheet) => <CharacterSheetCard key={sheet.id} sheet={sheet}
          book={books.find((item) => item.id === sheet.rule_book_id)} isOwner={sheet.user_id === userId}
          onRename={(name) => rename(sheet.id, name)} onSaveData={(data) => saveData(sheet.id, data)} onSaveLists={(lists) => saveLists(sheet.id, lists)} onDelete={() => remove(sheet)} />)}</div>}
      </section>
    </div>
  </div>;
}
