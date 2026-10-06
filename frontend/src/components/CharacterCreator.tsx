import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ActionLists, CharacterCreation, RuleBook } from "../api/types";
import { emptyActionLists, hasCompendium, sheetActionLists, startingLists, withPicks } from "../lib/actions";
import { fieldFromValue, objectFromFields, type Field } from "../lib/attributeFields";
import { completeCharacterData, CreationError, freeCharacterData, initialCreation, managedCharacterData, validateClassSelection, validateManagedData, validatePointAllocation, type CreationErrorGroup } from "../lib/characterCreation";
import { derivedStartingValues, type DerivedKey } from "../lib/characterStats";
import { ActionsEditor } from "./ActionsEditor";
import { CharacterStatBlock } from "./CharacterStatBlock";
import { CharacterValues } from "./CharacterValues";
import { ClassControls, FieldError, PointBuyControls } from "./CharacterCreationControls";
import { EquipmentPicker, type Entry, type ListKey } from "./EquipmentPicker";

type StepId = "basics" | "class" | "abilities" | "equipment" | "review";
const stepLabels: Record<StepId, string> = { basics: "Basics", class: "Class", abilities: "Abilities", equipment: "Equipment & spells", review: "Review" };

/** Number values shown together under "Hit points & defense"; other free values stay in "More details". */
const vitalLabels: Record<string, string> = {
  level: "Level", max_hit_points: "Max hit points", hit_points: "Current hit points", armor_class: "Armor class",
  initiative: "Initiative bonus", proficiency_bonus: "Proficiency bonus", speed_m: "Speed (m)",
};

/** Character values the player edits directly: vitals as typed text, everything else as fields. */
type Draft = { fields: Field[]; vitals: Record<string, string> };

function draftFor(book: RuleBook | undefined, creation: CharacterCreation): Draft {
  const draft: Draft = { fields: [], vitals: {} };
  for (const [key, value] of Object.entries(book ? freeCharacterData(book, creation, book.attributes) : {})) {
    if (Object.hasOwn(vitalLabels, key) && typeof value === "number") draft.vitals[key] = String(value);
    else draft.fields.push(fieldFromValue(key, value));
  }
  return draft;
}

/** The fresh draft for a new class, keeping what the player already entered for values that stay free. */
function carryDraft(previous: Draft, book: RuleBook, creation: CharacterCreation): Draft {
  const fresh = draftFor(book, creation);
  const managed = managedCharacterData(book, creation);
  const custom = previous.fields.filter((field) => !fresh.fields.some((item) => item.name === field.name) && !Object.hasOwn(managed, field.name) && !Object.hasOwn(fresh.vitals, field.name));
  return {
    fields: [...fresh.fields.map((field) => previous.fields.find((item) => item.name === field.name) ?? field), ...custom],
    vitals: Object.fromEntries(Object.entries(fresh.vitals).map(([key, value]) => [key, previous.vitals[key] ?? value])),
  };
}

function stepOf(group: CreationErrorGroup): StepId {
  if (group === "name" || group === "book") return "basics";
  if (group === "class" || group.startsWith("choice:")) return "class";
  if (group === "points" || group === "values" || group.startsWith("value:")) return "abilities";
  return "review";
}

/** The element that takes focus when the group has an error. */
function focusIdOf(group: CreationErrorGroup): string {
  if (group === "name") return "sheet-name";
  if (group === "book") return "sheet-book";
  if (group === "class") return "character-class";
  if (group.startsWith("choice:")) return `choice-${group.slice("choice:".length)}-0`;
  if (group.startsWith("value:")) return `vital-${group.slice("value:".length)}`;
  if (group === "points") return "point-buy-error";
  if (group === "values") return "character-values-error";
  return "character-form-error";
}

function sameIds(left: ActionLists, right: ActionLists) {
  return (["attacks", "actions", "items"] as const).every((key) => left[key].length === right[key].length && left[key].every((entry, index) => entry.id === right[key][index].id));
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
  const [draft, setDraft] = useState(() => draftFor(books.find((item) => item.id === bookId), creation));
  // Derived values the player typed themselves; the rest follow class, level and scores.
  const [edited, setEdited] = useState<ReadonlySet<string>>(() => new Set());
  const [lists, setLists] = useState<ActionLists>(() => {
    const initial = books.find((item) => item.id === bookId);
    return initial ? startingLists(initial, creation.class_id) : emptyActionLists();
  });
  const [step, setStep] = useState<StepId>("basics");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; group: CreationErrorGroup } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingLists, setEditingLists] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const book = books.find((item) => item.id === bookId);
  const selectedClass = book?.creation_rules.classes?.find((item) => item.id === creation.class_id);
  const steps: StepId[] = book
    ? ["basics", ...(book.creation_rules.classes?.length ? ["class" as const] : []), "abilities", ...(hasCompendium(book.compendium) ? ["equipment" as const] : []), "review"]
    : ["basics"];
  const current = steps.includes(step) ? step : "basics";
  const index = steps.indexOf(current);

  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);
  useEffect(() => {
    if (editingLists) editorRef.current?.querySelector<HTMLElement>("input, select, button")?.focus();
  }, [editingLists]);

  // The values derived ones are computed from: book defaults, typed vitals and class/score grants.
  const baseValues: Record<string, unknown> = book ? { ...book.attributes, ...Object.fromEntries(Object.entries(draft.vitals).map(([key, value]) => [key, value.trim() ? Number(value) : Number.NaN])), ...managedCharacterData(book, creation) } : {};
  const derived = derivedStartingValues(baseValues, edited);
  const derivedOf = (key: string) => edited.has(key) ? undefined : derived[key as DerivedKey];
  const vitalValue = (key: string) => {
    const calculated = derivedOf(key);
    return calculated ? String(calculated.value) : draft.vitals[key];
  };
  const errorFor = (group: CreationErrorGroup) => error?.group === group ? error.message : undefined;

  function report(err: unknown) {
    const next = err instanceof CreationError ? { message: err.message, group: err.group } : { message: err instanceof Error ? err.message : "Could not create the character.", group: "form" as const };
    setError(next);
    setStep(stepOf(next.group));
    if (next.group === "values") setDetailsOpen(true);
    setFocusRequest({ id: focusIdOf(next.group) });
  }
  function go(next: StepId) {
    setStep(next);
    setError(null);
    setFocusRequest({ id: "character-step-heading" });
  }
  function changeBook(id: string) {
    if (id === bookId) return;
    if (dirty && !window.confirm("Replace your edited character values with the new rule book’s defaults? Your character name will be kept.")) return;
    const next = books.find((item) => item.id === id);
    const nextCreation = initialCreation(next?.creation_rules ?? {});
    setBookId(id);
    setCreation(nextCreation);
    setDraft(draftFor(next, nextCreation));
    setEdited(new Set());
    setLists(emptyActionLists());
    setEditingLists(false);
    setDirty(false);
    setError(null);
  }
  function changeClass(id: string) {
    if (!book || id === creation.class_id) return;
    const kitEdited = !sameIds(lists, startingLists(book, creation.class_id));
    const chosen = Object.values(creation.choices ?? {}).some((values) => values.length > 0);
    if ((kitEdited || chosen) && !window.confirm("Changing class clears your class choices and swaps your equipment for the new class’s starting kit. Continue?")) return;
    const next = { ...creation, class_id: id, choices: {} };
    setCreation(next);
    setDraft((previous) => carryDraft(previous, book, next));
    setLists(startingLists(book, id));
    setEditingLists(false);
    setError(null);
  }
  function changeCreation(next: CharacterCreation) {
    setCreation(next);
    setDirty(true);
    setError(null);
  }
  function changeVital(key: string, value: string) {
    setDraft((previous) => ({ ...previous, vitals: { ...previous.vitals, [key]: value } }));
    if (Object.hasOwn(derived, key)) setEdited((previous) => new Set(previous).add(key));
    setDirty(true);
    setError(null);
  }
  function resetToCalculated(key: string) {
    setEdited((previous) => {
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  }
  function toggleEntry(key: ListKey, entry: Entry, checked: boolean) {
    setLists((previous) => {
      const rest = (previous[key] as Entry[]).filter((item) => item.id !== entry.id);
      return { ...previous, [key]: checked ? [...rest, { ...entry }] : rest };
    });
    setDirty(true);
  }

  /** The sheet data the character would be created with; throws a CreationError for the first bad value. */
  function characterData(target: RuleBook): Record<string, unknown> {
    let free: Record<string, unknown>;
    try { free = objectFromFields(draft.fields, "Character details"); }
    catch (err) { throw new CreationError(err instanceof Error ? err.message : "Check your character details.", "values"); }
    const vitals = Object.fromEntries(Object.keys(draft.vitals).map((key) => {
      const text = vitalValue(key);
      const value = Number(text);
      if (!text.trim() || !Number.isFinite(value)) throw new CreationError(`${vitalLabels[key]} must be a number.`, `value:${key}`);
      return [key, value];
    }));
    const data = { ...free, ...vitals };
    validateManagedData(target, creation, data);
    const values = completeCharacterData(target, creation, data);
    return hasCompendium(target.compendium) ? { ...values, ...withPicks(sheetActionLists(values), lists) } : values;
  }
  function check(id: StepId) {
    if (id === "basics") {
      if (!name.trim()) throw new CreationError("Give your character a name.", "name");
      if (!book) throw new CreationError("Choose a rule book for your character.", "book");
    }
    if (!book) return;
    if (id === "class") validateClassSelection(book, creation);
    if (id === "abilities") {
      validatePointAllocation(book, creation);
      characterData(book);
    }
  }
  async function create() {
    let data: Record<string, unknown>;
    try {
      steps.forEach(check);
      data = characterData(book!);
    } catch (err) { report(err); return; }
    setError(null);
    setBusy(true);
    try {
      await onCreate(name.trim(), book!.id, data, creation);
      const nextCreation = initialCreation(book!.creation_rules);
      setName("");
      setCreation(nextCreation);
      setDraft(draftFor(book, nextCreation));
      setEdited(new Set());
      setLists(emptyActionLists());
      setEditingLists(false);
      setDirty(false);
      setStep("basics");
    } catch (err) { report(err instanceof CreationError ? err : new CreationError(err instanceof Error ? err.message : "Could not create the character.", "form")); }
    finally { setBusy(false); }
  }
  function advance(event: FormEvent) {
    event.preventDefault();
    if (current === "review") { void create(); return; }
    try { check(current); } catch (err) { report(err); return; }
    go(steps[index + 1]);
  }

  let preview: { data: Record<string, unknown> } | { message: string } | null = null;
  if (book && current === "review") {
    try { preview = { data: characterData(book) }; }
    catch (err) { preview = { message: err instanceof Error ? err.message : "Some values need fixing." }; }
  }
  const vitalKeys = Object.keys(draft.vitals);
  const valuesError = errorFor("values");

  return <section className="card min-w-0 space-y-5" aria-labelledby="character-creator-heading">
    <div><h2 id="character-creator-heading" className="text-2xl">Create a character</h2>
      <nav aria-label="Character creation steps"><ol className="mt-3 flex flex-wrap gap-2">{steps.map((id, position) => <li key={id}>
        <button type="button" className={`rounded-full border px-3 py-1 text-sm ${id === current ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] text-[var(--lavender)]"}`} aria-current={id === current ? "step" : undefined} disabled={busy || editingLists} onClick={() => go(id)}>{position + 1}. {stepLabels[id]}</button>
      </li>)}</ol></nav>
    </div>
    <form id="character-step-form" className="min-w-0" onSubmit={advance} noValidate>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <h3 id="character-step-heading" tabIndex={-1} className="mb-0 text-lg">{stepLabels[current]}</h3>
        {current === "basics" && <>
          <div>
            <label className="field-label" htmlFor="sheet-name">Character name<input id="sheet-name" required value={name} aria-invalid={!!errorFor("name")} aria-describedby={errorFor("name") ? "sheet-name-error" : undefined} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="A name to remember" /></label>
            <FieldError id="sheet-name-error" message={errorFor("name")} />
          </div>
          <div>
            <label className="field-label" htmlFor="sheet-book">Rule book<select id="sheet-book" required value={bookId} disabled={!!lockedBookId} aria-invalid={!!errorFor("book")} aria-describedby={errorFor("book") ? "sheet-book-error" : undefined} onChange={(e) => changeBook(e.target.value)}>
              <option value="" disabled>Choose a rule book</option>
              {books.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <FieldError id="sheet-book-error" message={errorFor("book")} />
          </div>
          {books.length === 0 && <p className="text-muted text-sm">You’ll need a rule book first. <Link className="text-[var(--accent)] underline underline-offset-4" to="/rule-books">Create a rule book</Link>.</p>}
          {book && <p className="text-muted text-sm">Starting values come from <strong className="text-[var(--paper)]">{book.name}</strong>. Your changes apply only to this character.</p>}
        </>}
        {current === "class" && book && <ClassControls rules={book.creation_rules} creation={creation} errorFor={errorFor} onChange={changeCreation} onClassChange={changeClass} />}
        {current === "abilities" && book && <>
          <PointBuyControls rules={book.creation_rules} creation={creation} errorFor={errorFor} onChange={changeCreation} />
          {vitalKeys.length > 0 && <section className="min-w-0 space-y-3" aria-labelledby="vitals-heading">
            <h4 id="vitals-heading" className="mb-0 text-lg">Hit points & defense</h4>
            <p className="text-muted text-sm">Worked out from your class, level and ability scores. Type a value to set it yourself.</p>
            <div className="grid gap-4 sm:grid-cols-2">{vitalKeys.map((key) => {
              const calculated = derived[key as DerivedKey];
              const message = errorFor(`value:${key}`);
              const hintId = `vital-${key}-hint`;
              return <div key={key} className="min-w-0">
                <label className="field-label" htmlFor={`vital-${key}`}>{vitalLabels[key]}<input id={`vital-${key}`} type="number" step="any" value={vitalValue(key)} aria-invalid={!!message} aria-describedby={message ? `vital-${key}-error` : calculated ? hintId : undefined} onChange={(e) => changeVital(key, e.target.value)} /></label>
                {calculated && (edited.has(key)
                  ? <p id={hintId} className="text-muted mb-0 mt-1 text-xs">Set by you. <button type="button" className="text-[var(--accent)] underline underline-offset-4" onClick={() => resetToCalculated(key)}>Use calculated value ({calculated.value})</button></p>
                  : <p id={hintId} className="text-muted mb-0 mt-1 text-xs">{calculated.hint}</p>)}
                <FieldError id={`vital-${key}-error`} message={message} />
              </div>;
            })}</div>
          </section>}
          {(() => {
            const values = <>
              <FieldError id="character-values-error" message={valuesError} />
              {draft.fields.length === 0 && <p className="text-muted mb-0 text-sm">No other starting values. You can add your own details.</p>}
              <CharacterValues key={`${bookId}:${creation.class_id ?? ""}`} fields={draft.fields} reserved={[...Object.keys(managedCharacterData(book, creation)), ...vitalKeys, "class", "attacks", "actions", "items"]} onChange={(fields) => { setDraft((previous) => ({ ...previous, fields })); setDirty(true); setError(null); }} />
            </>;
            return book.creation_rules.point_buy || vitalKeys.length > 0
              ? <details className="min-w-0 rounded-lg border border-[var(--line)] p-3" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer text-[var(--lavender)]">More details <span className="text-muted text-xs">({draft.fields.length})</span></summary>
                <div className="mt-4 space-y-3">{values}</div>
              </details>
              : <div className="space-y-3">{values}</div>;
          })()}
        </>}
        {current === "equipment" && book && <>
          <p className="text-muted text-sm leading-relaxed">Your class’s starting equipment is already picked. Pick more from {book.name}, or add your own. You can change these later.</p>
          <EquipmentPicker compendium={book.compendium} picks={lists} spellList={selectedClass?.spell_list} className={selectedClass?.name} onToggle={toggleEntry} />
          <button type="button" className="btn-secondary" aria-expanded={editingLists} aria-controls="character-equipment-editor" onClick={() => setEditingLists((open) => !open)}>Customize or add your own</button>
        </>}
        {current === "review" && book && <>
          <p className="text-muted text-sm">Check your character before creating it. Use the steps above to change anything.</p>
          <p className="mb-0 text-lg">{name.trim() || "Unnamed character"}<span className="text-muted block text-sm">{[selectedClass?.name, book.name].filter(Boolean).join(" · ")}</span></p>
          {preview && ("data" in preview ? <CharacterStatBlock data={preview.data} /> : <p className="text-sm text-[var(--pink)]">{preview.message}</p>)}
          <FieldError id="character-form-error" message={errorFor("form")} />
        </>}
      </fieldset>
    </form>
    {current === "equipment" && book && editingLists && <div id="character-equipment-editor" ref={editorRef}>
      <ActionsEditor owner={{ id: "new-character", name: name.trim() || "New character", ...lists }} compendium={book.compendium} busy={busy}
        onSave={(next) => { setLists(next); setEditingLists(false); setDirty(true); }} onClose={() => setEditingLists(false)} />
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
      {index > 0 ? <button type="button" className="btn-secondary" disabled={busy || editingLists} onClick={() => go(steps[index - 1])}>Back</button> : <span />}
      <button type="submit" form="character-step-form" className="btn" disabled={busy || !book || editingLists}>
        {current === "review" ? busy ? "Creating…" : "Create character" : `Next: ${stepLabels[steps[index + 1]]}`}
      </button>
    </div>
    {editingLists && <p className="text-muted mb-0 text-xs">Save or cancel your equipment changes to continue.</p>}
  </section>;
}
