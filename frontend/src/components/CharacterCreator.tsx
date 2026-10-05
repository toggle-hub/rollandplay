import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import type { ActionLists, CharacterCreation, RuleBook, TokenAction, TokenAttack, TokenItem } from "../api/types";
import { compendiumSummary, emptyActionLists, hasCompendium, sheetActionLists, startingLists, withPicks } from "../lib/actions";
import { fieldFromValue, objectFromFields, parseAttributes } from "../lib/attributeFields";
import { ActionsEditor } from "./ActionsEditor";
import { CharacterValues } from "./CharacterValues";
import { CharacterCreationControls } from "./CharacterCreationControls";
import { completeCharacterData, CreationError, freeCharacterData, initialCreation, managedCharacterData, validateCharacterCreation, validateManagedData, type CreationErrorGroup } from "../lib/characterCreation";
import { useToast } from "./Toast";

type ListKey = keyof ActionLists;
type Entry = TokenAttack | TokenAction | TokenItem;
const equipmentGroups: { key: ListKey; label: string }[] = [
  { key: "attacks", label: "Weapons" },
  { key: "actions", label: "Spells & abilities" },
  { key: "items", label: "Items" },
];

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
  const [error, setError] = useState<{ message: string; group: CreationErrorGroup } | null>(null);
  const [lists, setLists] = useState<ActionLists>(() => {
    const initial = books.find((item) => item.id === bookId);
    return initial ? startingLists(initial, creation.class_id) : emptyActionLists();
  });
  const [editingLists, setEditingLists] = useState(false);
  const toast = useToast();
  const book = books.find((item) => item.id === bookId);

  function reportError(err: unknown, fallbackGroup: CreationErrorGroup) {
    const next = err instanceof CreationError ? { message: err.message, group: err.group }
      : err instanceof SyntaxError ? { message: "Character data must be valid JSON. Check your brackets and quotation marks.", group: "values" as const }
      : { message: err instanceof Error ? err.message : "Could not create the character.", group: fallbackGroup };
    setError(next);
    toast({ kind: "error", message: next.message });
  }
  function changeBook(id: string) {
    if (id === bookId) return;
    if (dirty && !window.confirm("Replace your edited character values with the new rule book’s defaults? Your character name will be kept.")) return;
    const next = books.find((item) => item.id === id);
    setBookId(id);
    setLists(emptyActionLists());
    setEditingLists(false);
    const nextCreation = initialCreation(next?.creation_rules ?? {});
    setCreation(nextCreation);
    setFields(fieldsFor(next, nextCreation));
    setJson(JSON.stringify(next ? completeCharacterData(next, nextCreation, {}) : {}, null, 2));
    setDirty(false);
    setError(null);
  }
  function changeClass(id: string) {
    if (!book || id === creation.class_id) return;
    if (dirty && !window.confirm("Changing class resets other character values and class choices. Your name and point allocation will be kept. Continue?")) return;
    const next = { ...creation, class_id: id, choices: {} };
    setLists(startingLists(book, id));
    setEditingLists(false);
    setCreation(next);
    setFields(fieldsFor(book, next));
    setJson(JSON.stringify(completeCharacterData(book, next, {}), null, 2));
    setDirty(true);
    setError(null);
  }
  function changeCreation(next: CharacterCreation) {
    if (!book) return;
    try {
      if (mode === "json") setJson(JSON.stringify({ ...parseAttributes(json, "Character data"), ...managedCharacterData(book, next) }, null, 2));
      setCreation(next);
      setDirty(true);
      setError(null);
    } catch (err) { reportError(err, "values"); }
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
      setError(null);
    } catch (err) { reportError(err, "values"); }
  }
  function toggleEntry(key: ListKey, entry: Entry, checked: boolean) {
    setLists((current) => {
      const rest = (current[key] as Entry[]).filter((item) => item.id !== entry.id);
      return { ...current, [key]: checked ? [...rest, { ...entry }] : rest };
    });
    setDirty(true);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    let data: Record<string, unknown>;
    try {
      if (!name.trim()) throw new CreationError("Give your character a name.", "name");
      if (!book) throw new CreationError("Choose a rule book for your character.", "book");
      validateCharacterCreation(book, creation);
      data = mode === "json" ? parseAttributes(json, "Character data") : objectFromFields(fields, "Character data");
      validateManagedData(book, creation, data);
    } catch (err) { reportError(err, "values"); return; }
    try {
      setBusy(true);
      const values = completeCharacterData(book, creation, data);
      const sheetData = hasCompendium(book.compendium) ? { ...values, ...withPicks(sheetActionLists(values), lists) } : values;
      await onCreate(name.trim(), book.id, sheetData, creation);
      setName("");
      const nextCreation = initialCreation(book.creation_rules);
      setCreation(nextCreation);
      setFields(fieldsFor(book, nextCreation));
      setJson(JSON.stringify(completeCharacterData(book, nextCreation, {}), null, 2));
      setLists(emptyActionLists());
      setEditingLists(false);
      setDirty(false);
    } catch (err) { reportError(err, "form"); }
    finally { setBusy(false); }
  }
  const groupAlert = (group: CreationErrorGroup) => error?.group === group && <p role="alert" className="text-sm text-[var(--pink)]">{error.message}</p>;
  const ownEntries = book ? equipmentGroups.flatMap(({ key }) => (lists[key] as Entry[]).filter((entry) => !(book.compendium[key] as Entry[]).some((item) => item.id === entry.id))) : [];

  return <div className="min-w-0 space-y-4">
    <form id="character-creator" className="card min-w-0" onSubmit={create} noValidate aria-labelledby="character-creator-heading">
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        {groupAlert("form")}
        <div><h2 id="character-creator-heading" className="text-2xl">Create a character</h2><p className="text-muted text-sm leading-relaxed">Choose your rules, name your hero, and make their starting values your own.</p></div>
        {groupAlert("name")}
        <label className="field-label" htmlFor="sheet-name">Character name<input id="sheet-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="A name to remember" /></label>
        {groupAlert("book")}
        <label className="field-label" htmlFor="sheet-book">Rule book<select id="sheet-book" required value={bookId} disabled={!!lockedBookId} onChange={(e) => changeBook(e.target.value)}>
          <option value="" disabled>Choose a rule book</option>
          {books.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {books.length === 0 && <p className="text-muted text-sm">You’ll need a rule book first. <Link className="text-[var(--accent)] underline underline-offset-4" to="/rule-books">Create a rule book</Link>.</p>}
        {book && <>
          <p className="rounded-lg border border-[var(--line)] p-3 text-sm text-[var(--lavender)]">Starting values come from <strong>{book.name}</strong>. Your edits apply only to this character, not the rule book.</p>
          <CharacterCreationControls rules={book.creation_rules} creation={creation} error={error} onChange={changeCreation} onClassChange={changeClass} />
          {hasCompendium(book.compendium) && <section className="min-w-0 space-y-4 border-t border-[var(--line)] pt-5" aria-labelledby="equipment-heading">
            <h3 id="equipment-heading" className="mb-0 text-lg">Equipment & spells</h3>
            <p className="text-muted text-sm leading-relaxed">Your class's starting equipment is already picked. Pick more from {book.name}, or add your own. You can change these later on your sheet.</p>
            {equipmentGroups.filter(({ key }) => book.compendium[key].length > 0).map(({ key, label }) => <fieldset key={key} className="min-w-0 space-y-2">
              <legend className="field-label">{label}</legend>
              <div className="grid gap-2 sm:grid-cols-2">{(book.compendium[key] as Entry[]).map((entry) => <label key={entry.id} className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={(lists[key] as Entry[]).some((item) => item.id === entry.id)} onChange={(e) => toggleEntry(key, entry, e.target.checked)} />
                <span className="min-w-0">{entry.name}<span className="text-muted block text-xs">{compendiumSummary(entry)}</span></span>
              </label>)}</div>
            </fieldset>)}
            {ownEntries.length > 0 && <p className="mb-0 text-sm">Your own: {ownEntries.map((entry) => entry.name).join(", ")}</p>}
            <button type="button" className="btn-secondary" aria-expanded={editingLists} onClick={() => setEditingLists((open) => !open)}>Customize or add your own</button>
            {editingLists && <p className="text-muted mb-0 text-xs">The editor opens below this form.</p>}
          </section>}
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="mb-0 text-lg">Character values</h3><div className="flex gap-2" role="group" aria-label="Character editor mode">
            <button type="button" className={mode === "inputs" ? "btn" : "btn-secondary"} aria-pressed={mode === "inputs"} onClick={() => switchMode("inputs")}>Inputs</button>
            <button type="button" className={mode === "json" ? "btn" : "btn-secondary"} aria-pressed={mode === "json"} onClick={() => switchMode("json")}>JSON</button>
          </div></div>
          {groupAlert("values")}
        </>}
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
    </form>
    {book && editingLists && hasCompendium(book.compendium) && <ActionsEditor owner={{ id: "new-character", name: name.trim() || "New character", ...lists }} compendium={book.compendium} busy={busy}
      onSave={(next) => { setLists(next); setEditingLists(false); setDirty(true); }} onClose={() => setEditingLists(false)} />}
  </div>;
}
