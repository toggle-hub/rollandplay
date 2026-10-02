import { Plus, Trash } from "@phosphor-icons/react";
import { defaults, fieldFromValue, typeLabels, type Field, type FieldType } from "../lib/attributeFields";

export function AttributeFields({ fields, onChange, list = false }: { fields: Field[]; onChange: (fields: Field[]) => void; list?: boolean }) {
  function update(id: string, changes: Partial<Field>) {
    onChange(fields.map((field) => field.id === id ? { ...field, ...changes } : field));
  }
  return <div className="min-w-0 space-y-3">
    {fields.map((field, index) => <div key={field.id} className="min-w-0 space-y-3 rounded-lg border border-[var(--line)] p-3">
      <div className="flex flex-wrap items-end gap-3">
        {list ? <span className="mb-3 text-sm text-muted">Item {index + 1}</span> : <label className="field-label min-w-0 flex-1 basis-40">
          Attribute name
          <input value={field.name} onChange={(e) => update(field.id, { name: e.target.value })} placeholder="e.g. strength" />
        </label>}
        <label className="field-label min-w-0 flex-1 basis-32">
          Type
          <select value={field.type} onChange={(e) => {
            const replacement = fieldFromValue(field.name, defaults[e.target.value as FieldType]);
            update(field.id, { ...replacement, id: field.id });
          }}>{Object.entries(typeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select>
        </label>
        <button type="button" className="btn-secondary !px-3" aria-label={`Remove ${list ? `item ${index + 1}` : field.name || "attribute"}`} onClick={() => onChange(fields.filter((entry) => entry.id !== field.id))}><Trash size={18} aria-hidden="true" /></button>
      </div>
      {(field.type === "number" || field.type === "text") && <label className="field-label">
        Default value
        <input type={field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} value={field.value} onChange={(e) => update(field.id, { value: e.target.value })} />
      </label>}
      {field.type === "boolean" && <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={field.value === "true"} onChange={(e) => update(field.id, { value: String(e.target.checked) })} />Enabled by default</label>}
      {field.type === "null" && <p className="text-muted text-xs">No default value. Stored as null.</p>}
      {(field.type === "group" || field.type === "list") && <details>
        <summary className="cursor-pointer py-2 text-sm text-[var(--lavender)]">{field.type === "group" ? "Group attributes" : "List items"} ({field.children.length})</summary>
        <AttributeFields fields={field.children} list={field.type === "list"} onChange={(children) => update(field.id, { children })} />
      </details>}
    </div>)}
    <button type="button" className="btn-secondary" onClick={() => onChange([...fields, fieldFromValue("", 0)])}><Plus size={18} aria-hidden="true" />{list ? "Add list item" : "Add attribute"}</button>
  </div>;
}
