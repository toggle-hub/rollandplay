import { useEffect, useState } from "react";
import { BookOpen, Copy, PencilSimple, Trash } from "@phosphor-icons/react";
import { apiFetch, deleteJSON, patchJSON, postJSON } from "../api/client";
import type { RuleBook } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { RuleBookCreator, type RuleBookInput } from "../components/RuleBookCreator";
import { humanizeKey } from "../lib/checks";
import { formatValue, monsterSummary } from "../lib/ruleBooks";

export function RuleBooksPage() {
  const [items, setItems] = useState<RuleBook[]>([]);
  const [source, setSource] = useState<RuleBook>();
  const [editing, setEditing] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState("");
  const [deleting, setDeleting] = useState("");
  const { session } = useSession();
  const userId = session.status === "authenticated" ? session.user.id : "";
  useEffect(() => {
    apiFetch<RuleBook[]>("/api/rule-books").then((books) => setItems(books ?? [])).catch((err: Error) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  function resetDraft(book: RuleBook | undefined, edit: boolean) {
    setSource(book);
    setEditing(edit);
    setDirty(false);
    setDraftVersion((version) => version + 1);
  }
  async function save(input: RuleBookInput) {
    setSaving(true);
    try {
      if (editing && source) {
        const book = await patchJSON<RuleBook>(`/api/rule-books/${source.id}`, input);
        setItems((current) => current.map((item) => item.id === book.id ? book : item));
        resetDraft(undefined, false);
        setNotice(`“${book.name}” saved. Rooms and new characters using it get the changes.`);
      } else {
        const book = await postJSON<RuleBook>("/api/rule-books", input);
        setItems((current) => {
          const builtIns = current.filter((item) => item.owner_id === null);
          return [...builtIns, book, ...current.filter((item) => item.owner_id !== null)];
        });
        resetDraft(undefined, false);
        setNotice(`“${book.name}” created. It is ready to use for new characters.`);
      }
    } finally { setSaving(false); }
  }
  function startFrom(book?: RuleBook, edit = false) {
    if (saving) return;
    if (dirty && !window.confirm(editing ? "Discard your unsaved changes to this rule book?" : "Replace your unsaved rule book draft?")) return;
    resetDraft(book, edit && !!book);
    setNotice("");
    requestAnimationFrame(() => document.getElementById("book-name")?.focus());
  }
  async function remove(book: RuleBook) {
    setDeleting(book.id); setError(""); setNotice("");
    try {
      await deleteJSON<void>(`/api/rule-books/${book.id}`);
      setItems((current) => current.filter((item) => item.id !== book.id));
      if (source?.id === book.id) resetDraft(undefined, false);
      setNotice(`“${book.name}” deleted.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not delete the rule book."); }
    finally { setDeleting(""); setConfirming(""); }
  }

  return <div className="workspace-page">
    <header><h1 className="page-heading">Rule books</h1></header>
    {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
    {notice && <p role="status" className="text-[var(--green)]">{notice}</p>}
    <div className="grid grid-flow-dense items-start gap-6 xl:grid-cols-[minmax(260px,0.7fr)_minmax(0,1.3fr)]">
      <div className="min-w-0 xl:col-start-2 xl:row-start-1"><RuleBookCreator key={draftVersion} books={items} source={source} editing={editing} loading={loading} onSourceChange={(book) => startFrom(book)} onStopEditing={() => startFrom(undefined)} onDirty={() => setDirty(true)} onSubmit={save} /></div>
      <section className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1"><h2 className="text-xl">Your library</h2>
        {loading ? <p role="status" className="text-muted">Opening your library…</p> : items.length === 0 ? <div className="card empty-state py-16"><BookOpen size={44} weight="thin" className="mx-auto mb-5 text-[var(--accent)]" aria-hidden="true" /><h3 className="text-xl">Write the rules of your world.</h3><p className="text-muted mx-auto mt-3 max-w-sm text-sm">Create a rule book with the attributes your characters will use.</p></div> : <div className="grid grid-flow-dense gap-4 md:grid-cols-2 xl:grid-cols-1">{items.map((item) => {
          const owned = !!userId && item.owner_id === userId;
          const classes = item.creation_rules.classes ?? [];
          return <article className="card min-w-0 space-y-4" key={item.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="mb-0 min-w-0 break-words text-xl">{item.name}</h3>
              <span className="rounded-full bg-[var(--green)]/10 px-3 py-1 text-xs text-[var(--green)]">{item.owner_id === null ? "Built-in · Read only" : owned ? "Yours" : "Shared with you"}</span>
            </div>
            <p className="text-muted text-sm">{Object.keys(item.attributes).length} attributes · {classes.length ? `${classes.length} classes` : "No class restrictions"} · {item.creation_rules.point_buy ? `${item.creation_rules.point_buy.budget}-point allocation` : "Free-form scores"} · {item.monsters?.length ? `${item.monsters.length} monsters` : "No monsters"}</p>
            <details><summary className="cursor-pointer text-sm text-[var(--lavender)]">View character defaults</summary>
              <dl className="mt-3 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">{Object.entries(item.attributes).map(([key, value]) => <div key={key} className="contents">
                <dt className="text-muted">{humanizeKey(key)}</dt><dd className="m-0 break-words text-[var(--paper)]">{formatValue(value)}</dd>
              </div>)}</dl>
            </details>
            {classes.length > 0 && <details><summary className="cursor-pointer text-sm text-[var(--lavender)]">View classes</summary>
              <p className="mt-3 text-sm">{classes.map((cls) => cls.name).join(", ")}</p>
            </details>}
            {!!item.monsters?.length && <details><summary className="cursor-pointer text-sm text-[var(--lavender)]">View monsters</summary><ul className="mt-3 space-y-1 text-sm">{item.monsters.map((monster) => <li key={monster.id}><span className="text-[var(--paper)]">{monster.name}</span>{monsterSummary(monster) && <span className="text-muted"> · {monsterSummary(monster)}</span>}</li>)}</ul></details>}
            <div className="flex flex-wrap gap-3">
              {owned && <button type="button" className="btn flex-1" disabled={saving} onClick={() => startFrom(item, true)} aria-label={`Edit ${item.name}`}><PencilSimple size={18} aria-hidden="true" />Edit</button>}
              <button type="button" className="btn-secondary flex-1" disabled={saving} onClick={() => startFrom(item)} aria-label={`Extend ${item.name}`}><Copy size={18} aria-hidden="true" />Extend into a copy</button>
            </div>
            {owned && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[var(--paper)]/10 pt-4">
              {confirming === item.id ? <>
                <span className="mr-auto text-sm text-[var(--pink)]">Delete this rule book?</span>
                <button type="button" className="btn-secondary text-[var(--pink)]" onClick={() => void remove(item)} disabled={deleting === item.id}>{deleting === item.id ? "Deleting…" : "Confirm"}</button>
                <button type="button" className="btn-secondary" onClick={() => setConfirming("")} disabled={deleting === item.id}>Cancel</button>
              </> : <button type="button" className="btn-secondary" aria-label={`Delete ${item.name}`} onClick={() => setConfirming(item.id)}><Trash size={18} aria-hidden="true" />Delete</button>}
            </div>}
          </article>;
        })}</div>}
      </section>
    </div>
  </div>;
}
