import { FormEvent, useState } from "react";
import type { ActionLists, CreationRules, Monster, RuleBook } from "../api/types";

import { emptyActionLists } from "../lib/actions";
import { fieldFromValue, objectFromFields, parseAttributes } from "../lib/attributeFields";
import { creationRulesDraft, rulesFromDraft } from "../lib/creationRulesConfig";
import { monsterDrafts, monstersFromDrafts } from "../lib/monsters";
import { ActionsEditor } from "./ActionsEditor";
import { AttributeFields } from "./AttributeFields";
import { CreationRulesEditor } from "./CreationRulesEditor";
import { MonstersEditor } from "./MonstersEditor";

type Props = {
  books: RuleBook[];
  source?: RuleBook;
  loading: boolean;
  onSourceChange: (book?: RuleBook) => void;
  onDirty: () => void;
  onCreate: (name: string, attributes: Record<string, unknown>, rules: CreationRules, monsters: Monster[], compendium: ActionLists) => Promise<void>;
};

export function RuleBookCreator({ books, source, loading, onSourceChange, onDirty, onCreate }: Props) {
  const [name, setName] = useState(source ? `${source.name} — extended` : "");
  const [fields, setFields] = useState(() => Object.entries(source?.attributes ?? {}).map(([key, value]) => fieldFromValue(key, value)));
  const [rules, setRules] = useState(() => creationRulesDraft(source?.creation_rules));
  const [monsters, setMonsters] = useState(() => monsterDrafts(source?.monsters));
  const [compendium, setCompendium] = useState<ActionLists>(() => source?.compendium ?? emptyActionLists());
  const [editingCompendium, setEditingCompendium] = useState(false);
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reportError(err: unknown) {
    setError(err instanceof SyntaxError ? "Attributes and creation rules must contain valid JSON. Check your brackets and quotation marks." : err instanceof Error ? err.message : "Could not create the rule book.");
  }
  function switchMode(next: typeof mode) {
    if (next === mode) return;
    try {
      if (next === "json") setJson(JSON.stringify(objectFromFields(fields), null, 2));
      else setFields(Object.entries(parseAttributes(json)).map(([key, value]) => fieldFromValue(key, value)));
      setMode(next);
      setError("");
    } catch (err) { reportError(err); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const attributes = mode === "json" ? parseAttributes(json) : objectFromFields(fields);
      const creationRules = rulesFromDraft(rules, attributes, compendium);
      const bookMonsters = monstersFromDrafts(monsters);
      if (!name.trim()) throw new Error("Give your rule book a name.");
      setBusy(true);
      await onCreate(name.trim(), attributes, creationRules, bookMonsters, compendium);
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  return <div className="min-w-0 space-y-4">
    <form id="rule-book-creator" className="card min-w-0" onSubmit={create} noValidate aria-labelledby="creator-heading">
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div><h2 id="creator-heading" className="text-2xl">{source ? "Extend a rule book" : "Create a rule book"}</h2><p className="text-muted text-sm leading-relaxed">Build your character defaults one attribute at a time. No code required.</p></div>
        <label className="field-label">Start from
          <select value={source?.id ?? ""} disabled={loading} onChange={(e) => onSourceChange(books.find((book) => book.id === e.target.value))}>
            <option value="">Blank rule book</option>
            {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
          </select>
        </label>
        {source && <p className="rounded-lg border border-[var(--line)] p-3 text-sm text-[var(--lavender)]">Starting with all defaults from <strong>{source.name}</strong>. Add, change, or remove attributes below. This creates an independent copy; the original stays unchanged.</p>}
        <label className="field-label" htmlFor="book-name">Name<input id="book-name" required value={name} onChange={(e) => { setName(e.target.value); onDirty(); }} placeholder="Your game system" /></label>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="mb-0 text-lg">Character defaults</h3><div className="flex gap-2" role="group" aria-label="Attribute editor mode">
          <button type="button" className={mode === "fields" ? "btn" : "btn-secondary"} aria-pressed={mode === "fields"} onClick={() => switchMode("fields")}>Inputs</button>
          <button type="button" className={mode === "json" ? "btn" : "btn-secondary"} aria-pressed={mode === "json"} onClick={() => switchMode("json")}>JSON</button>
        </div></div>
        {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
        {mode === "fields" ? <>
          <p className="text-muted text-sm">Choose a name, type, and starting value. Use groups for related attributes, such as skills or saving throws.</p>
          {fields.length === 0 && <p className="empty-state !p-5 text-sm">No attributes yet. Add your first attribute, or start from a book in your library.</p>}
          <AttributeFields fields={fields} onChange={(next) => { setFields(next); onDirty(); }} />
        </> : <>
          <label className="field-label" htmlFor="book-attributes">Attributes (JSON)<textarea id="book-attributes" className="!min-h-80 w-full !font-mono !text-sm" spellCheck={false} value={json} onChange={(e) => { setJson(e.target.value); onDirty(); }} aria-describedby="attributes-help" /></label>
          <p id="attributes-help" className="text-muted text-xs leading-relaxed">Use a JSON object, for example {`{"strength": 10, "inspiration": false}`}. Switch back to Inputs to edit the same values without JSON.</p>
        </>}
        <CreationRulesEditor draft={rules} compendium={compendium} onChange={(next) => { setRules(next); onDirty(); }} />
        <MonstersEditor drafts={monsters} onChange={(next) => { setMonsters(next); onDirty(); }} bookAttributes={() => {
          try { return mode === "json" ? parseAttributes(json) : objectFromFields(fields); } catch { return {}; }
        }} />
        <section className="min-w-0 space-y-4 border-t border-[var(--line)] pt-5" aria-labelledby="compendium-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="compendium-heading" className="mb-0 text-lg">Compendium</h3>
            <button type="button" className="btn-secondary" aria-expanded={editingCompendium} onClick={() => setEditingCompendium((open) => !open)}>Edit compendium</button>
          </div>
          <p className="text-muted text-xs">{compendium.attacks.length} weapons · {compendium.actions.length} spells and abilities · {compendium.items.length} items</p>
          <p className="text-muted text-sm">Weapons, spells and items characters can pick at creation. Classes can grant some as starting equipment.</p>
          {editingCompendium && <p className="text-muted mb-0 text-xs">The compendium editor opens below this form.</p>}
        </section>
        <div className="border-t border-[var(--line)] pt-5"><button className="btn w-full" disabled={busy || !name.trim()}>{busy ? "Creating…" : source ? "Create extended rule book" : "Create rule book"}</button><p className="mb-0 mt-3 text-muted text-xs">New characters inherit these defaults. Existing characters are not changed.</p></div>
      </fieldset>
    </form>
    {editingCompendium && <ActionsEditor owner={{ id: "compendium", name: "Compendium", ...compendium }} limits={{ attacks: 300, actions: 300, items: 300 }} busy={false}
      onSave={(lists) => { setCompendium(lists); setEditingCompendium(false); onDirty(); }} onClose={() => setEditingCompendium(false)} />}
  </div>;
}
