import { FormEvent, useState } from "react";
import type { ActionLists, CreationRules, Monster, RuleBook } from "../api/types";

import { emptyActionLists } from "../lib/actions";
import { fieldFromValue, objectFromFields, parseAttributes } from "../lib/attributeFields";
import { creationRulesDraft, rulesFromDraft } from "../lib/creationRulesConfig";
import { monsterDrafts, monstersFromDrafts } from "../lib/monsters";
import { ActionsEditor } from "./ActionsEditor";
import { AdvancedJson } from "./AdvancedJson";
import { AttributeFields } from "./AttributeFields";
import { CreationRulesEditor } from "./CreationRulesEditor";
import { MonstersEditor } from "./MonstersEditor";

/** The body of `POST /api/rule-books` and of an editing `PATCH`. */
export type RuleBookInput = { name: string; attributes: Record<string, unknown>; creation_rules: CreationRules; monsters: Monster[]; compendium: ActionLists };

type Props = {
  books: RuleBook[];
  source?: RuleBook;
  /** Saves change `source` itself instead of creating a copy of it. */
  editing: boolean;
  loading: boolean;
  onSourceChange: (book?: RuleBook) => void;
  onStopEditing: () => void;
  onDirty: () => void;
  onSubmit: (book: RuleBookInput) => Promise<void>;
};

export function RuleBookCreator({ books, source, editing, loading, onSourceChange, onStopEditing, onDirty, onSubmit }: Props) {
  const [name, setName] = useState(source ? editing ? source.name : `${source.name} — extended` : "");
  const [fields, setFields] = useState(() => Object.entries(source?.attributes ?? {}).map(([key, value]) => fieldFromValue(key, value)));
  const [rules, setRules] = useState(() => creationRulesDraft(source?.creation_rules));
  const [monsters, setMonsters] = useState(() => monsterDrafts(source?.monsters));
  const [compendium, setCompendium] = useState<ActionLists>(() => source?.compendium ?? emptyActionLists());
  const [editingCompendium, setEditingCompendium] = useState(false);
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  let attributes: Record<string, unknown> = {};
  try { attributes = mode === "json" ? parseAttributes(json) : objectFromFields(fields); } catch { /* unfinished input: rule and monster editors offer no book values yet */ }

  function reportError(err: unknown) {
    setError(err instanceof SyntaxError ? "Attributes and creation rules must contain valid JSON. Check your brackets and quotation marks." : err instanceof Error ? err.message : "Could not save the rule book.");
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const bookAttributes = mode === "json" ? parseAttributes(json) : objectFromFields(fields);
      const creationRules = rulesFromDraft(rules, bookAttributes, compendium);
      const bookMonsters = monstersFromDrafts(monsters);
      if (!name.trim()) throw new Error("Give your rule book a name.");
      setBusy(true);
      await onSubmit({ name: name.trim(), attributes: bookAttributes, creation_rules: creationRules, monsters: bookMonsters, compendium });
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  const heading = editing && source ? `Edit “${source.name}”` : source ? "Extend a rule book" : "Create a rule book";
  return <form id="rule-book-creator" className="card min-w-0" onSubmit={submit} noValidate aria-labelledby="creator-heading">
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 id="creator-heading" className="break-words text-2xl">{heading}</h2><p className="text-muted mb-0 text-sm leading-relaxed">Build your character defaults one attribute at a time. No code required.</p></div>
        {editing && <button type="button" className="btn-secondary" onClick={onStopEditing}>Stop editing</button>}
      </div>
      {editing ? <div className="space-y-2 rounded-lg border border-[var(--line)] p-3 text-sm text-[var(--lavender)]">
        <p className="mb-0">Changes apply everywhere this book is used. Rooms playing with it get the new monsters and compendium right away, and new characters start from the new defaults and creation rules.</p>
        <p className="mb-0">Characters already made keep their own values, and monsters already on a map keep their stats. To leave this book as it is, extend it into a copy instead.</p>
      </div> : <>
        <label className="field-label">Start from
          <select value={source?.id ?? ""} disabled={loading} onChange={(e) => onSourceChange(books.find((book) => book.id === e.target.value))}>
            <option value="">Blank rule book</option>
            {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
          </select>
        </label>
        {source && <p className="rounded-lg border border-[var(--line)] p-3 text-sm text-[var(--lavender)]">Starting with all defaults from <strong>{source.name}</strong>. Add, change, or remove attributes below. This creates an independent copy; the original stays unchanged.</p>}
      </>}
      <label className="field-label" htmlFor="book-name">Name<input id="book-name" required value={name} onChange={(e) => { setName(e.target.value); onDirty(); }} placeholder="Your game system" /></label>
      <section className="min-w-0 space-y-4" aria-labelledby="defaults-heading">
        <h3 id="defaults-heading" className="mb-0 text-lg">Character defaults</h3>
        {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
        {mode === "fields" && <>
          <p className="text-muted text-sm">Choose a name, type, and starting value. Use groups for related attributes, such as skills or saving throws.</p>
          {fields.length === 0 && <p className="empty-state !p-5 text-sm">No attributes yet. Add your first attribute, or start from a book in your library.</p>}
          <AttributeFields fields={fields} onChange={(next) => { setFields(next); onDirty(); }} />
        </>}
        <AdvancedJson id="book-attributes" label="character defaults" open={mode === "json"} value={json} onToggle={() => switchMode(mode === "json" ? "fields" : "json")} onChange={(value) => { setJson(value); onDirty(); }}
          help={<p className="text-muted mb-0 text-xs leading-relaxed">Use a JSON object, for example {`{"strength": 10, "inspiration": false}`}.</p>} />
      </section>
      <CreationRulesEditor draft={rules} attributes={attributes} compendium={compendium} onChange={(next) => { setRules(next); onDirty(); }} />
      <MonstersEditor drafts={monsters} bookAttributes={attributes} compendium={compendium} onChange={(next) => { setMonsters(next); onDirty(); }} />
      <section className="min-w-0 space-y-4 border-t border-[var(--line)] pt-5" aria-labelledby="compendium-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="compendium-heading" className="mb-0 text-lg">Compendium</h3>
          <button type="button" className="btn-secondary" aria-expanded={editingCompendium} onClick={() => setEditingCompendium((open) => !open)}>Edit compendium</button>
        </div>
        <p className="text-muted text-xs">{compendium.attacks.length} weapons · {compendium.actions.length} spells and abilities · {compendium.items.length} items</p>
        <p className="text-muted text-sm">Weapons, spells and items characters can pick at creation. Classes can grant some as starting equipment.</p>
        {editingCompendium && <ActionsEditor owner={{ id: "compendium", name: "Compendium", ...compendium }} limits={{ attacks: 300, actions: 300, items: 300 }} embedded saveLabel="Apply to compendium" busy={false}
          onSave={(lists) => { setCompendium(lists); setEditingCompendium(false); onDirty(); }} onClose={() => setEditingCompendium(false)} />}
      </section>
      <div className="border-t border-[var(--line)] pt-5">
        <button className="btn w-full" disabled={busy || !name.trim()}>{busy ? "Saving…" : editing ? "Save changes" : source ? "Create extended rule book" : "Create rule book"}</button>
        <p className="mb-0 mt-3 text-muted text-xs">{editing ? "Existing characters and monsters already on a map are not changed." : "New characters inherit these defaults. Existing characters are not changed."}</p>
      </div>
    </fieldset>
  </form>;
}
