import { useState } from "react";

type Field<T> = { server: T; draft: T };

/**
 * A form field that follows its server value while untouched. When the server value changes,
 * an untouched field takes the new value and an edited one keeps the edit. `dirty` says whether
 * the draft differs from the current server value, so a save can send only what was changed.
 */
export function useSyncedField<T>(server: T, same: (a: T, b: T) => boolean = Object.is) {
  const [field, setField] = useState<Field<T>>({ server, draft: server });
  let current = field;
  if (!same(field.server, server)) {
    current = { server, draft: same(field.draft, field.server) ? server : field.draft };
    setField(current);
  }
  const setDraft = (next: T | ((draft: T) => T)) =>
    setField((value) => ({ ...value, draft: typeof next === "function" ? (next as (draft: T) => T)(value.draft) : next }));
  return { value: current.draft, set: setDraft, dirty: !same(current.draft, current.server) };
}

/** Compares lists as sets, so order does not make a field dirty. */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}
