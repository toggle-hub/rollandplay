/**
 * Postgres jsonb (and the Go server's maps) lose object key order, so the server sends the order the
 * author wrote next to rule books and sheets as `key_order: {field: KeyOrder}` (see backend
 * migration 012_key_order.sql). Objects list their `keys` (and `children` for nested values);
 * arrays list one order per item in `items`.
 */
export type KeyOrder = { keys?: string[]; children?: Record<string, KeyOrder>; items?: KeyOrder[] } | null | undefined;

/** Returns `value` with its object keys in `order`; keys the order does not know keep their place after them. */
export function applyKeyOrder<T>(value: T, order: KeyOrder): T {
  if (!order || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const items = order.items;
    return (items ? value.map((item, index) => applyKeyOrder(item, items[index])) : value) as T;
  }
  if (!order.keys) return value;
  const source = value as Record<string, unknown>;
  const placed = new Set<string>();
  const entries: [string, unknown][] = [];
  for (const key of order.keys) {
    if (!Object.hasOwn(source, key) || placed.has(key)) continue;
    placed.add(key);
    entries.push([key, applyKeyOrder(source[key], order.children?.[key])]);
  }
  for (const [key, child] of Object.entries(source)) {
    if (!placed.has(key)) entries.push([key, child]);
  }
  // fromEntries defines own properties, so a "__proto__" key stays data.
  return Object.fromEntries(entries) as T;
}

/** Applies and removes `key_order` on an API response: one record or a list of records. */
export function restoreKeyOrder<T>(body: T): T {
  return (Array.isArray(body) ? body.map(restoreRecord) : restoreRecord(body)) as T;
}

function restoreRecord(record: unknown): unknown {
  if (!record || typeof record !== "object" || Array.isArray(record) || !Object.hasOwn(record, "key_order")) return record;
  const { key_order: orders, ...fields } = record as Record<string, unknown>;
  if (orders && typeof orders === "object") {
    for (const [field, order] of Object.entries(orders as Record<string, KeyOrder>)) {
      if (Object.hasOwn(fields, field)) fields[field] = applyKeyOrder(fields[field], order);
    }
  }
  return fields;
}
