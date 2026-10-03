import { useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import { defaults, fieldFromValue, typeLabels, type Field, type FieldType } from "../lib/attributeFields";
import { useToast } from "./Toast";

function fieldLabel(name: string) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function CharacterValues({ fields, onChange, list = false }: { fields: Field[]; onChange: (fields: Field[]) => void; list?: boolean }) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");
  const [error, setError] = useState("");
  const toast = useToast();
  function update(id: string, changes: Partial<Field>) {
    onChange(fields.map((field) => field.id === id ? { ...field, ...changes } : field));
  }
  function add() {
    const name = newName.trim();
    const message = list ? "" : !name ? "Enter a name for the attribute." : fields.some((field) => field.name === name) ? "That attribute already exists in this group." : "";
    if (message) { setError(message); toast({ kind: "error", message }); return; }
    onChange([...fields, fieldFromValue(list ? "" : name, defaults[newType])]);
    setNewName("");
    setError("");
  }
  return <div className={`grid min-w-0 grid-flow-dense gap-4 ${list ? "grid-cols-1" : "sm:grid-cols-2"}`}>
    {fields.map((field, index) => {
      const label = list ? `Item ${index + 1}` : fieldLabel(field.name);
      const container = field.type === "group" || field.type === "list";
      return <div key={field.id} className={`min-w-0 ${container ? "col-span-full" : ""} ${list ? "flex items-start gap-3" : ""}`}>
        <div className="min-w-0 flex-1">
          {(field.type === "number" || field.type === "text") && <label className="field-label" htmlFor={field.id} title={field.name}>{label}
            <input id={field.id} type={field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} value={field.value} onChange={(e) => update(field.id, { value: e.target.value })} />
          </label>}
          {field.type === "boolean" && <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[var(--line)] p-3 text-sm" title={field.name}>
            <input type="checkbox" checked={field.value === "true"} onChange={(e) => update(field.id, { value: String(e.target.checked) })} />{label}
          </label>}
          {field.type === "null" && <label className="field-label">{label}
            <select value="null" onChange={(e) => update(field.id, { ...fieldFromValue(field.name, defaults[e.target.value as FieldType]), id: field.id })}>
              <option value="null">Not set</option>
              {Object.entries(typeLabels).filter(([type]) => type !== "null").map(([type, text]) => <option key={type} value={type}>Set {text.toLowerCase()}</option>)}
            </select>
          </label>}
          {container && <details className="min-w-0 rounded-lg border border-[var(--line)] p-3">
            <summary className="cursor-pointer py-1 text-[var(--lavender)]" title={field.name}>{label} <span className="text-muted text-xs">({field.children.length})</span></summary>
            <div className="mt-4"><CharacterValues fields={field.children} list={field.type === "list"} onChange={(children) => update(field.id, { children })} /></div>
          </details>}
        </div>
        {list && <button type="button" className="btn-secondary !px-3" aria-label={`Remove item ${index + 1}`} onClick={() => onChange(fields.filter((entry) => entry.id !== field.id))}><Trash size={18} aria-hidden="true" /></button>}
      </div>;
    })}
    <details className="col-span-full min-w-0 border-t border-[var(--line)] pt-3">
      <summary className="cursor-pointer text-sm text-[var(--lavender)]">{list ? "Add list item" : "Add a custom attribute"}</summary>
      {error && <p role="alert" className="mt-3 text-sm text-[var(--pink)]">{error}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {!list && <label className="field-label min-w-0 flex-1 basis-40">Attribute name<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. backstory" /></label>}
        <label className="field-label min-w-0 flex-1 basis-32">Value type<select value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>{Object.entries(typeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label>
        <button type="button" className="btn-secondary" onClick={add}><Plus size={18} aria-hidden="true" />{list ? "Add item" : "Add attribute"}</button>
      </div>
    </details>
  </div>;
}
