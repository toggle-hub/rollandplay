import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import type { CharacterCreation, RuleBook } from "../api/types";
import { fieldFromValue, objectFromFields, parseAttributes } from "../lib/attributeFields";
import { CharacterValues } from "./CharacterValues";
import { CharacterCreationControls } from "./CharacterCreationControls";
import { completeCharacterData, freeCharacterData, initialCreation, managedCharacterData, validateCharacterCreation, validateManagedData } from "../lib/characterCreation";

function fieldsFromData(data: Record<string, unknown>) {
  return Object.entries(data).map(([key, value]) => fieldFromValue(key, value));
}

function fieldsFor(book: RuleBook | undefined, creation: CharacterCreation, data?: Record<string, unknown>) {
  return fieldsFromData(book ? freeCharacterData(book, creation, data ?? book.attributes) : {});
}

type Props = {
  books: RuleBook[];
  /** Fixes the rule book, e.g. when creating a character for a room invite. */
  lockedBookId?: string;
  onCreate: (name: string, bookId: string, data: Record<string, unknown>, creation: CharacterCreation) => Promise<void>;
};

export function CharacterCreator({ books, lockedBookId, onCreate }: Props) {
  const [name, setName] = useState("");
  const [bookId, setBookId] = useState(lockedBookId ?? books[0]?.id ?? "");
  const [creation, setCreation] = useState(() => initialCreation(books.find((item) => item.id === bookId)?.creation_rules ?? {}));
  const [fields, setFields] = useState(() => fieldsFor(books.find((item) => item.id === bookId), creation));
  const [mode, setMode] = useState<"inputs" | "json">("inputs");
  const [json, setJson] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const book = books.find((item) => item.id === bookId);

  function reportError(err: unknown) {
    setError(err instanceof SyntaxError ? "Character data must be valid JSON. Check your brackets and quotation marks." : err instanceof Error ? err.message : "Could not create the character.");
  }
  function changeBook(id: string) {
    if (id === bookId) return;
    if (dirty && !window.confirm("Replace your edited character values with the new rule book’s defaults? Your character name will be kept.")) return;
    const next = books.find((item) => item.id === id);
    setBookId(id);
    const nextCreation = initialCreation(next?.creation_rules ?? {});
    setCreation(nextCreation);
    setFields(fieldsFor(next, nextCreation));
    setJson(JSON.stringify(next ? completeCharacterData(next, nextCreation, {}) : {}, null, 2));
    setDirty(false);
    setError("");
  }
  function changeClass(id: string) {
    if (!book || id === creation.class_id) return;
    if (dirty && !window.confirm("Changing class resets other character values and class choices. Your name and point allocation will be kept. Continue?")) return;
    const next = { ...creation, class_id: id, choices: {} };
    setCreation(next);
    setFields(fieldsFor(book, next));
    setJson(JSON.stringify(completeCharacterData(book, next, {}), null, 2));
    setDirty(true);
    setError("");
  }
  function changeCreation(next: CharacterCreation) {
    if (!book) return;
    try {
      if (mode === "json") setJson(JSON.stringify({ ...parseAttributes(json, "Character data"), ...managedCharacterData(book, next) }, null, 2));
      setCreation(next);
      setDirty(true);
      setError("");
    } catch (err) { reportError(err); }
  }
  function switchMode(next: typeof mode) {
    if (next === mode || !book) return;
    try {
      if (next === "json") {
        const data = objectFromFields(fields, "Character data");
        validateManagedData(book, creation, data);
        setJson(JSON.stringify(completeCharacterData(book, creation, data), null, 2));
      } else {
        const data = parseAttributes(json, "Character data");
        validateManagedData(book, creation, data);
        setFields(fieldsFor(book, creation, completeCharacterData(book, creation, data)));
      }
      setMode(next);
      setError("");
    } catch (err) { reportError(err); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (!name.trim()) throw new Error("Give your character a name.");
      if (!book) throw new Error("Choose a rule book for your character.");
      validateCharacterCreation(book, creation);
      const data = mode === "json" ? parseAttributes(json, "Character data") : objectFromFields(fields, "Character data");
      validateManagedData(book, creation, data);
      setBusy(true);
      await onCreate(name.trim(), book.id, completeCharacterData(book, creation, data), creation);
      setName("");
      const nextCreation = initialCreation(book.creation_rules);
      setCreation(nextCreation);
      setFields(fieldsFor(book, nextCreation));
      setJson(JSON.stringify(completeCharacterData(book, nextCreation, {}), null, 2));
      setDirty(false);
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  return <form id="character-creator" className="card min-w-0" onSubmit={create} noValidate aria-labelledby="character-creator-heading">
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div><h2 id="character-creator-heading" className="text-2xl">Create a character</h2><p className="text-muted text-sm leading-relaxed">Choose your rules, name your hero, and make their starting values your own.</p></div>
      <label className="field-label" htmlFor="sheet-name">Character name<input id="sheet-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="A name to remember" /></label>
      <label className="field-label" htmlFor="sheet-book">Rule book<select id="sheet-book" required value={bookId} disabled={!!lockedBookId} onChange={(e) => changeBook(e.target.value)}>
        <option value="" disabled>Choose a rule book</option>
        {books.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {books.length === 0 && <p className="text-muted text-sm">You’ll need a rule book first. <Link className="text-[var(--accent)] underline underline-offset-4" to="/rule-books">Create a rule book</Link>.</p>}
      {book && <>
        <p className="rounded-lg border border-[var(--line)] p-3 text-sm text-[var(--lavender)]">Starting values come from <strong>{book.name}</strong>. Your edits apply only to this character, not the rule book.</p>
        <CharacterCreationControls rules={book.creation_rules} creation={creation} onChange={changeCreation} onClassChange={changeClass} />
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="mb-0 text-lg">Character values</h3><div className="flex gap-2" role="group" aria-label="Character editor mode">
          <button type="button" className={mode === "inputs" ? "btn" : "btn-secondary"} aria-pressed={mode === "inputs"} onClick={() => switchMode("inputs")}>Inputs</button>
          <button type="button" className={mode === "json" ? "btn" : "btn-secondary"} aria-pressed={mode === "json"} onClick={() => switchMode("json")}>JSON</button>
        </div></div>
      </>}
      {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
      {book && (mode === "inputs" ? <>
        <p className="text-muted text-sm leading-relaxed">Set hit points and other character-specific values below. Class-granted values and point allocation are controlled above. Derived stats are not calculated automatically.</p>
        {fields.length === 0 && <p className="empty-state !p-5 text-sm">No other starting attributes. You can add custom character details below.</p>}
        <CharacterValues key={`${bookId}:${creation.class_id ?? ""}`} fields={fields} onChange={(next) => { setFields(next); setDirty(true); }} />
      </> : <>
        <label className="field-label" htmlFor="sheet-data">Character data (JSON)<textarea id="sheet-data" className="!min-h-80 w-full !font-mono !text-sm" spellCheck={false} value={json} onChange={(e) => { setJson(e.target.value); setDirty(true); }} aria-describedby="sheet-data-help" /></label>
        <p id="sheet-data-help" className="text-muted text-xs leading-relaxed">Edit other character values here. Class, point-bought scores, and class choices must match the controls above; JSON cannot override those rules. Omitted top-level attributes use rule book defaults; other nested objects replace their default group. Derived stats remain manual.</p>
      </>)}
      <div className="border-t border-[var(--line)] pt-5"><button className="btn w-full" disabled={busy || !book || !name.trim()}>{busy ? "Creating…" : "Create character"}</button><p className="mb-0 mt-3 text-muted text-xs">Your character will be available to bring into a room.</p></div>
    </fieldset>
  </form>;
}
