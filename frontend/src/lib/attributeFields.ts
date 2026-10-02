export type FieldType = "number" | "text" | "boolean" | "group" | "list" | "null";
export type Field = { id: string; name: string; type: FieldType; value: string; children: Field[] };
export const defaults: Record<FieldType, unknown> = { number: 0, text: "", boolean: false, group: {}, list: [], null: null };
export const typeLabels: Record<FieldType, string> = { number: "Number", text: "Text", boolean: "Yes / no", group: "Group", list: "List", null: "No value (null)" };

export function fieldFromValue(name: string, value: unknown): Field {
  const type: FieldType = value === null ? "null" : Array.isArray(value) ? "list" : typeof value === "object" ? "group" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text";
  return {
    id: crypto.randomUUID(), name, type,
    value: type === "group" || type === "list" || type === "null" ? "" : String(value),
    children: type === "group" || type === "list" ? Object.entries(value as object).map(([key, child]) => fieldFromValue(key, child)) : [],
  };
}

export function objectFromFields(fields: Field[], path = "Attributes"): Record<string, unknown> {
  const names = new Set<string>();
  return Object.fromEntries(fields.map((field) => {
    if (!field.name.trim()) throw new Error(`${path}: give every attribute a name.`);
    if (names.has(field.name)) throw new Error(`${path}: “${field.name}” is used twice. Attribute names must be unique within a group.`);
    names.add(field.name);
    return [field.name, valueFromField(field, `${path} → ${field.name}`)];
  }));
}

function valueFromField(field: Field, path: string): unknown {
  switch (field.type) {
    case "number": {
      const number = Number(field.value);
      if (!field.value.trim() || !Number.isFinite(number)) throw new Error(`${path}: enter a valid number.`);
      return number;
    }
    case "text": return field.value;
    case "boolean": return field.value === "true";
    case "null": return null;
    case "group": return objectFromFields(field.children, path);
    case "list": return field.children.map((child, index) => valueFromField(child, `${path} → item ${index + 1}`));
  }
}

export function parseAttributes(json: string, label = "Attributes"): Record<string, unknown> {
  const value: unknown = JSON.parse(json, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error(`${label} numbers must be finite.`);
    return item;
  });
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object, for example {"strength": 10}.`);
  return value as Record<string, unknown>;
}
