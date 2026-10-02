import { useEffect, useState } from "react";
import { BookOpen, Copy } from "@phosphor-icons/react";
import { apiFetch, patchJSON, postJSON } from "../api/client";
import type { CreationRules, Monster, RuleBook } from "../api/types";
import { RuleBookCreator } from "../components/RuleBookCreator";

export function RuleBooksPage() {
  const [items, setItems] = useState<RuleBook[]>([]);
  const [source, setSource] = useState<RuleBook>();
  const [draftVersion, setDraftVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = async () => setItems((await apiFetch<RuleBook[]>("/api/rule-books")) ?? []);
  useEffect(() => { load().catch((err: Error) => setError(err.message)).finally(() => setLoading(false)); }, []);
  async function create(name: string, attributes: Record<string, unknown>, rules: CreationRules, monsters: Monster[]) {
    setCreating(true);
    try {
      const book = await postJSON<RuleBook>("/api/rule-books", { name, attributes, creation_rules: rules, monsters });
      setItems((current) => {
        const builtIns = current.filter((item) => item.owner_id === null);
        return [...builtIns, book, ...current.filter((item) => item.owner_id !== null)];
      });
      setSource(undefined);
      setDirty(false);
      setDraftVersion((version) => version + 1);
      setNotice(`“${book.name}” created. It is ready to use for new characters.`);
    } finally { setCreating(false); }
  }
  function startFrom(book?: RuleBook) {
    if (creating) return;
    if (dirty && !window.confirm("Replace your unsaved rule book draft?")) return;
    setSource(book);
    setDirty(false);
    setDraftVersion((version) => version + 1);
    setNotice("");
    requestAnimationFrame(() => document.getElementById("book-name")?.focus());
  }
  async function rename(id: string, value: string) {
    setError("");
    try { await patchJSON(`/api/rule-books/${id}`, { name: value }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save the name."); }
  }
  return <div className="workspace-page">
    <header><p className="eyebrow">The foundations of play</p><h1 className="page-heading max-w-5xl">Rule books</h1><p className="page-description">Make the rules your own. Start fresh or extend a rule book with your world's character defaults.</p></header>
    {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
    {notice && <p role="status" className="text-[var(--green)]">{notice}</p>}
    <div className="grid grid-flow-dense items-start gap-6 xl:grid-cols-[minmax(260px,0.7fr)_minmax(0,1.3fr)]">
      <div className="min-w-0 xl:col-start-2 xl:row-start-1"><RuleBookCreator key={draftVersion} books={items} source={source} loading={loading} onSourceChange={startFrom} onDirty={() => setDirty(true)} onCreate={create} /></div>
      <section className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1"><h2 className="text-xl">Your library</h2>
        {loading ? <p role="status" className="text-muted">Opening your library…</p> : items.length === 0 ? <div className="card empty-state py-16"><BookOpen size={44} weight="thin" className="mx-auto mb-5 text-[var(--accent)]" aria-hidden="true" /><h3 className="text-xl">Write the rules of your world.</h3><p className="text-muted mx-auto mt-3 max-w-sm text-sm">Create a rule book with the attributes your characters will use.</p></div> : <div className="grid grid-flow-dense gap-4 md:grid-cols-2 xl:grid-cols-1">{items.map((item) => <article className="card min-w-0 space-y-4" key={item.id}>
          {item.owner_id === null ? <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="mb-0 text-xl">{item.name}</h3>
              <span className="rounded-full bg-[var(--green)]/10 px-3 py-1 text-xs text-[var(--green)]">Built-in · Read only</span>
            </div>
            <p className="text-muted text-sm">Shared defaults, ready to use when creating a character.</p>
          </> : <>
            <label className="field-label block" htmlFor={`book-${item.id}`}>Rule book name</label>
            <input id={`book-${item.id}`} className="w-full" defaultValue={item.name} onBlur={(e) => { if (e.target.value !== item.name) void rename(item.id, e.target.value); }} />
            <p className="text-muted text-xs">Name saves when you leave the field.</p>
          </>}
          <p className="text-muted text-sm">{Object.keys(item.attributes).length} attributes · {item.owner_id === null ? "Built-in defaults" : "Custom defaults"}</p>
          <p className="text-muted text-xs">{item.creation_rules.classes?.length ? `${item.creation_rules.classes.length} classes` : "No class restrictions"} · {item.creation_rules.point_buy ? `${item.creation_rules.point_buy.budget}-point allocation` : "Free-form scores"} · {item.monsters?.length ? `${item.monsters.length} monsters` : "No monsters"}</p>
          {!!item.monsters?.length && <details><summary className="cursor-pointer text-sm text-[var(--lavender)]">View monsters</summary><ul className="mt-3 space-y-1 text-sm">{item.monsters.map((monster) => <li key={monster.id}><span className="text-[var(--paper)]">{monster.name}</span>{monster.description && <span className="text-muted"> · {monster.description}</span>}</li>)}</ul></details>}
          <button type="button" className="btn-secondary w-full" disabled={creating} onClick={() => startFrom(item)} aria-label={`Extend ${item.name}`}><Copy size={18} aria-hidden="true" />Extend this rule book</button>
          <details><summary className="cursor-pointer text-sm text-[var(--lavender)]">View attributes (JSON)</summary><pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-[var(--paper)]/10 bg-[var(--input)]/20 p-4 text-xs leading-relaxed">{JSON.stringify(item.attributes, null, 2)}</pre></details>
        </article>)}</div>}
      </section>
    </div>
  </div>;
}
