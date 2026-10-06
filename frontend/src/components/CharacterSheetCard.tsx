import { FormEvent, useId, useState } from "react";
import { PencilSimple, Sword, Trash } from "@phosphor-icons/react";
import type { ActionLists, RuleBook, Sheet } from "../api/types";
import { sheetActionLists } from "../lib/actions";
import { fieldFromValue, objectFromFields } from "../lib/attributeFields";
import { sheetHighlights } from "../lib/characterStats";
import { ActionsEditor } from "./ActionsEditor";
import { CharacterStatBlock } from "./CharacterStatBlock";
import { CharacterValues } from "./CharacterValues";

/** Sheet lists edited with the actions editor rather than as plain values. */
const listKeys: Record<string, true> = { attacks: true, actions: true, items: true };

type Props = {
  sheet: Sheet;
  book?: RuleBook;
  isOwner: boolean;
  onRename: (name: string) => Promise<void>;
  onSaveData: (data: Record<string, unknown>) => Promise<void>;
  onSaveLists: (lists: ActionLists) => Promise<void>;
  onDelete: () => Promise<void>;
};

type Mode = "summary" | "view" | "edit" | "lists";

export function CharacterSheetCard({ sheet, book, isOwner, onRename, onSaveData, onSaveLists, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>("summary");
  const [fields, setFields] = useState(() => Object.entries(sheet.data).filter(([key]) => !listKeys[key]).map(([key, value]) => fieldFromValue(key, value)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const highlights = sheetHighlights(sheet.data);
  const className = typeof sheet.data.class === "string" ? sheet.data.class : "";

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try { await action(); return true; }
    catch (err) { setError(err instanceof Error ? err.message : fallback); return false; }
    finally { setBusy(false); }
  }
  function startEdit() {
    setFields(Object.entries(sheet.data).filter(([key]) => !listKeys[key]).map(([key, value]) => fieldFromValue(key, value)));
    setError("");
    setMode("edit");
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    let values: Record<string, unknown>;
    try { values = objectFromFields(fields, "Character values"); }
    catch (err) { setError(err instanceof Error ? err.message : "Check the character values."); return; }
    const lists = Object.fromEntries(Object.entries(sheet.data).filter(([key]) => listKeys[key]));
    if (await run(() => onSaveData({ ...values, ...lists }), "Could not save the character.")) setMode("view");
  }
  async function remove() {
    if (!window.confirm(`Delete “${sheet.name}”? This can’t be undone. Its tokens are removed from every room map, and rooms where you play it keep you as a member without a character.`)) return;
    await run(onDelete, "Could not delete the character.");
  }

  return <article className="card min-w-0 space-y-4" aria-labelledby={`${id}-name`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 id={`${id}-name`} className="mb-0 text-xl break-words">{sheet.name}</h3>
        <p className="text-muted mb-0 text-sm">{[className, book?.name ?? "Linked rule book"].filter(Boolean).join(" · ")}{!isOwner && " · shared by another player"}</p>
      </div>
      {highlights.length > 0 && <dl className="flex flex-wrap gap-2 text-sm">{highlights.map((item) => <div key={item.label} className="rounded-lg border border-[var(--line)] px-2 py-1">
        <dt className="text-muted inline">{item.label} </dt><dd className="inline">{item.value}</dd>
      </div>)}</dl>}
    </div>
    {error && <p role="alert" className="text-sm text-[var(--pink)]">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" aria-expanded={mode === "view"} onClick={() => setMode((open) => open === "view" ? "summary" : "view")}>{mode === "view" ? "Hide character" : "View character"}</button>
      {isOwner && <>
        <button type="button" className="btn-secondary" aria-expanded={mode === "edit"} disabled={busy} onClick={() => mode === "edit" ? setMode("summary") : startEdit()}><PencilSimple size={18} aria-hidden="true" />Edit</button>
        <button type="button" className="btn-secondary" aria-expanded={mode === "lists"} disabled={busy} onClick={() => setMode((open) => open === "lists" ? "summary" : "lists")}><Sword size={18} aria-hidden="true" />Attacks & spells</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void remove()}><Trash size={18} aria-hidden="true" />Delete</button>
      </>}
    </div>
    {mode === "view" && <CharacterStatBlock data={sheet.data} />}
    {mode === "edit" && <form className="min-w-0 space-y-4 border-t border-[var(--line)] pt-4" onSubmit={saveEdit} noValidate aria-label={`Edit ${sheet.name}`}>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <RenameField sheet={sheet} onRename={onRename} />
        <p className="text-muted text-sm">Change scores, hit points, proficiencies and other values, for example after leveling up. Attacks, spells and items are edited with <strong className="text-[var(--paper)]">Attacks & spells</strong>.</p>
        <CharacterValues fields={fields} reserved={Object.keys(listKeys)} onChange={setFields} />
        <div className="flex flex-wrap gap-2">
          <button className="btn">{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn-secondary" onClick={() => { setMode("view"); setError(""); }}>Cancel</button>
        </div>
      </fieldset>
    </form>}
    {mode === "lists" && <ActionsEditor owner={{ id: sheet.id, name: sheet.name, ...sheetActionLists(sheet.data) }} compendium={book?.compendium}
      busy={busy} onSave={(lists) => void run(() => onSaveLists(lists), "Could not save attacks, spells and items.").then((saved) => { if (saved) setMode("summary"); })} onClose={() => setMode("summary")} />}
  </article>;
}

function RenameField({ sheet, onRename }: { sheet: Sheet; onRename: (name: string) => Promise<void> }) {
  const [error, setError] = useState("");
  const id = useId();
  async function rename(value: string) {
    const name = value.trim();
    if (name === sheet.name) return;
    if (!name) { setError("Give your character a name."); return; }
    setError("");
    try { await onRename(name); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save the name."); }
  }
  return <div>
    <label className="field-label" htmlFor={id}>Character name<input id={id} defaultValue={sheet.name} aria-invalid={!!error} aria-describedby={`${id}-help`} onBlur={(e) => void rename(e.target.value)} /></label>
    {error ? <p id={`${id}-help`} role="alert" className="mb-0 mt-1 text-sm text-[var(--pink)]">{error}</p> : <p id={`${id}-help`} className="text-muted mb-0 mt-1 text-xs">The name saves when you leave the field.</p>}
  </div>;
}
