import { useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import { defaults, fieldFromValue, type Field } from "../lib/attributeFields";
import { humanizeKey } from "../lib/checks";
import { uniqueSlug } from "../lib/ruleBooks";
import { AttributeFields } from "./AttributeFields";

/** Book keys a class can't grant: the class name itself, and lists that come from starting equipment. */
const notGrantable = ["class", "attacks", "actions", "items"];
const newTypes = [
  { value: "number", label: "Number" },
  { value: "text", label: "Text" },
  { value: "boolean", label: "Yes / no" },
] as const;

type Props = {
  classLabel: string;
  fields: Field[];
  /** The book's character defaults; a granted value starts from the book's value and keeps its shape. */
  attributes: Record<string, unknown>;
  onChange: (fields: Field[]) => void;
};

/** Values a class sets for its characters, each edited with an input that fits it. */
export function ClassValuesEditor({ classLabel, fields, attributes, onChange }: Props) {
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<(typeof newTypes)[number]["value"]>("number");
  const granted = new Set(fields.map((field) => field.name));
  const offered = Object.keys(attributes).filter((key) => !granted.has(key) && !notGrantable.includes(key));
  const newKey = uniqueSlug(newName, granted, "");
  const update = (id: string, next: Field) => onChange(fields.map((field) => field.id === id ? next : field));

  return <div className="min-w-0 space-y-3">
    {fields.length === 0 && <p className="text-muted mb-0 text-sm">This class grants nothing yet.</p>}
    {fields.map((field) => <div key={field.id} className="min-w-0 space-y-2 rounded-lg border border-[var(--line)] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--paper)]">{humanizeKey(field.name)}</span>
        <button type="button" className="btn-secondary !min-h-8 !px-2" aria-label={`Stop granting ${humanizeKey(field.name)}`} onClick={() => onChange(fields.filter((item) => item.id !== field.id))}><Trash size={16} aria-hidden="true" /></button>
      </div>
      <ValueInput field={field} label={humanizeKey(field.name)} onChange={(next) => update(field.id, next)} />
    </div>)}
    <div className="flex flex-wrap items-end gap-3">
      <label className="field-label min-w-0 flex-1 basis-48">Grant a value from the book
        <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`Grant a value to ${classLabel}`}>
          <option value="">Choose a value</option>
          {offered.map((key) => <option key={key} value={key}>{humanizeKey(key)}</option>)}
        </select>
      </label>
      <button type="button" className="btn-secondary" disabled={!choice} onClick={() => {
        onChange([...fields, fieldFromValue(choice, attributes[choice])]);
        setChoice("");
      }}><Plus size={18} aria-hidden="true" />Grant</button>
    </div>
    <details className="rounded-lg border border-[var(--line)] p-3">
      <summary className="cursor-pointer text-sm text-[var(--lavender)]">Grant something the book doesn't have</summary>
      <p className="text-muted mt-2 text-xs">For values only this class sets, such as a hit die.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="field-label min-w-0 flex-1 basis-40">Name<input value={newName} placeholder="e.g. Hit die" onChange={(e) => setNewName(e.target.value)} /></label>
        <label className="field-label min-w-0 flex-1 basis-32">Kind
          <select value={newType} onChange={(e) => setNewType(e.target.value as typeof newType)}>{newTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
        </label>
        <button type="button" className="btn-secondary" disabled={!newKey} onClick={() => {
          onChange([...fields, fieldFromValue(newKey, defaults[newType])]);
          setNewName("");
        }}><Plus size={18} aria-hidden="true" />Add</button>
      </div>
    </details>
  </div>;
}

/** An input shaped by the value: number, text, a yes/no box, a set of yes/no boxes, or the nested values of a group. */
function ValueInput({ field, label, onChange }: { field: Field; label: string; onChange: (field: Field) => void }) {
  switch (field.type) {
    case "number":
    case "text":
      return <input aria-label={label} type={field.type === "number" ? "number" : "text"} step={field.type === "number" ? "any" : undefined} className="w-full" value={field.value} onChange={(e) => onChange({ ...field, value: e.target.value })} />;
    case "boolean":
      return <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={field.value === "true"} onChange={(e) => onChange({ ...field, value: String(e.target.checked) })} />{label}</label>;
    case "null":
      return <p className="text-muted mb-0 text-xs">No value.</p>;
    case "list":
      return <AttributeFields fields={field.children} list onChange={(children) => onChange({ ...field, children })} />;
    case "group": {
      const setChild = (next: Field) => onChange({ ...field, children: field.children.map((child) => child.id === next.id ? next : child) });
      if (field.children.length > 0 && field.children.every((child) => child.type === "boolean")) {
        return <fieldset className="grid gap-1 sm:grid-cols-2"><legend className="sr-only">{label}</legend>
          {field.children.map((child) => <label key={child.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={child.value === "true"} onChange={(e) => setChild({ ...child, value: String(e.target.checked) })} />{humanizeKey(child.name)}
          </label>)}
        </fieldset>;
      }
      return <div className="min-w-0 space-y-2 border-l border-[var(--line)] pl-3">
        {field.children.map((child) => <div key={child.id} className="min-w-0 space-y-1">
          {child.type !== "boolean" && <span className="text-muted block text-xs">{humanizeKey(child.name)}</span>}
          <ValueInput field={child} label={humanizeKey(child.name)} onChange={setChild} />
        </div>)}
      </div>;
    }
  }
}
