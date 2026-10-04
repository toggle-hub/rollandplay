import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, deleteJSON, patchJSON, postJSON } from "../api/client";
import type { GameMap, MapStructure } from "../api/types";
import { expandToGroups, sortByZ } from "./structureGroups";

export type StructureFields = Partial<Pick<MapStructure, "geometry" | "kind" | "blocks_vision" | "blocks_movement" | "blocks_attacks" | "z_index" | "group_id">>;
export type StructureUpdate = { id: string; fields: StructureFields };
/** A structure to create. Without `z_index` the server puts it on top. */
export type NewStructure = Omit<MapStructure, "id" | "map_id" | "z_index" | "group_id"> & Partial<Pick<MapStructure, "z_index" | "group_id">>;

type FieldChange = { id: string; before: StructureFields; after: StructureFields };
type HistoryEntry =
  | { type: "update"; changes: FieldChange[] }
  | { type: "create"; structures: MapStructure[] }
  | { type: "delete"; structures: MapStructure[] };

const historyLimit = 100;

/**
 * Map, selection and undo/redo history for the map editor. Every edit is applied locally first and
 * persisted structure by structure; history entries are only kept for edits the server accepted.
 */
export function useStructureEditor(mapId: string | undefined) {
  const [map, setMap] = useState<GameMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [, setHistoryVersion] = useState(0);
  const busyRef = useRef(false);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const structures = useMemo(() => sortByZ(map?.structures ?? []), [map?.structures]);

  const setBusy = (next: boolean) => {
    busyRef.current = next;
    setBusyState(next);
  };
  const historyChanged = () => setHistoryVersion((version) => version + 1);
  const push = (stack: HistoryEntry[], entry: HistoryEntry) => {
    stack.push(entry);
    if (stack.length > historyLimit) stack.shift();
    historyChanged();
  };
  const startEdit = (entry: HistoryEntry) => {
    push(undoStack.current, entry);
    redoStack.current = [];
  };

  const load = async () => setMap(await apiFetch<GameMap>(`/api/maps/${mapId}`));
  const resync = () => load().catch(() => undefined);

  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    historyChanged();
    setSelectedIds([]);
    setLoading(true);
    setError("");
    load().catch((err: Error) => setError(err.message)).finally(() => setLoading(false));
  }, [mapId]);

  const select = (ids: string[]) => setSelectedIds(expandToGroups(ids, structures));

  async function runSaving(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      setNotice(message);
    } catch (err) {
      setError(err instanceof SyntaxError ? "Geometry must be valid JSON: an array of points with x and y coordinates." : err instanceof Error ? err.message : "Could not save the map.");
    } finally {
      setBusy(false);
    }
  }

  const applyFields = (changes: { id: string; fields: StructureFields }[]) => {
    const next = new Map(changes.map((change) => [change.id, change.fields]));
    setMap((current) => current ? {
      ...current,
      structures: current.structures?.map((structure) => {
        const fields = next.get(structure.id);
        return fields ? { ...structure, ...fields } : structure;
      }),
    } : current);
  };
  /** PATCHes every change and waits for all of them, so a reload after a failure sees every write that landed. */
  async function patchAll(changes: { id: string; fields: StructureFields }[]) {
    const results = await Promise.allSettled(changes.map((change) => patchJSON(`/api/maps/${mapId}/structures/${change.id}`, change.fields)));
    const failedIds = new Set(changes.filter((_, index) => results[index].status === "rejected").map((change) => change.id));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
    return { failedIds, failure };
  }
  const addLocal = (created: MapStructure[]) =>
    setMap((current) => current ? { ...current, structures: [...(current.structures ?? []), ...created] } : current);
  const removeLocal = (ids: Set<string>) => {
    setMap((current) => current ? { ...current, structures: current.structures?.filter((structure) => !ids.has(structure.id)) } : current);
    setSelectedIds((current) => current.filter((id) => !ids.has(id)));
  };

  /** POSTs each structure; returns the server copies paired with their source and the ones that failed. */
  async function postAll<T>(sources: T[], payload: (source: T) => NewStructure) {
    const results = await Promise.allSettled(sources.map((source) => postJSON<MapStructure>(`/api/maps/${mapId}/structures`, payload(source))));
    const created: { source: T; structure: MapStructure }[] = [];
    const failed: T[] = [];
    let failure: unknown;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") created.push({ source: sources[index], structure: result.value });
      else {
        failed.push(sources[index]);
        failure ??= result.reason;
      }
    });
    if (created.length > 0) addLocal(created.map(({ structure }) => structure));
    return { created, failed, failure };
  }

  async function deleteAll(doomed: MapStructure[]) {
    const results = await Promise.allSettled(doomed.map((structure) => deleteJSON(`/api/maps/${mapId}/structures/${structure.id}`)));
    const deleted = doomed.filter((_, index) => results[index].status === "fulfilled");
    const failed = doomed.filter((_, index) => results[index].status === "rejected");
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
    if (deleted.length > 0) removeLocal(new Set(deleted.map((structure) => structure.id)));
    return { deleted, failed, failure };
  }

  /** Recreated structures get new ids; every history step must follow them. */
  const remapIds = (ids: Map<string, string>) => {
    if (ids.size === 0) return;
    const remap = (id: string) => ids.get(id) ?? id;
    const rewrite = (entry: HistoryEntry): HistoryEntry => entry.type === "update"
      ? { ...entry, changes: entry.changes.map((change) => ({ ...change, id: remap(change.id) })) }
      : { ...entry, structures: entry.structures.map((structure) => ({ ...structure, id: remap(structure.id) })) };
    undoStack.current = undoStack.current.map(rewrite);
    redoStack.current = redoStack.current.map(rewrite);
  };

  const errorMessage = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback;

  async function update(updates: StructureUpdate[], message?: string) {
    if (busyRef.current || updates.length === 0) return;
    const current = new Map(structures.map((structure) => [structure.id, structure]));
    const changes = updates.flatMap(({ id, fields }) => {
      const structure = current.get(id);
      if (!structure) return [];
      const before = Object.fromEntries(Object.keys(fields).map((key) => [key, structure[key as keyof StructureFields] ?? null])) as StructureFields;
      return [{ id, before, after: fields }];
    });
    if (changes.length === 0) return;
    const entry: HistoryEntry = { type: "update", changes };
    startEdit(entry);
    applyFields(changes.map((change) => ({ id: change.id, fields: change.after })));
    setBusy(true);
    setError("");
    try {
      const { failedIds, failure } = await patchAll(changes.map((change) => ({ id: change.id, fields: change.after })));
      if (failedIds.size === 0) {
        if (message) setNotice(message);
        return;
      }
      // Keep undo for the changes the server accepted; put the rejected ones back.
      const saved = changes.filter((change) => !failedIds.has(change.id));
      const index = undoStack.current.indexOf(entry);
      if (index !== -1) {
        if (saved.length > 0) undoStack.current[index] = { type: "update", changes: saved };
        else undoStack.current.splice(index, 1);
      }
      historyChanged();
      applyFields(changes.filter((change) => failedIds.has(change.id)).map((change) => ({ id: change.id, fields: change.before })));
      setError(errorMessage(failure, "Could not update the structure."));
      await resync();
    } finally {
      setBusy(false);
    }
  }

  async function create(payloads: NewStructure[], message?: string): Promise<MapStructure[]> {
    if (busyRef.current || payloads.length === 0) return [];
    setBusy(true);
    setError("");
    try {
      const { created, failure } = await postAll(payloads, (payload) => payload);
      const structuresCreated = created.map(({ structure }) => structure);
      if (structuresCreated.length > 0) startEdit({ type: "create", structures: structuresCreated });
      if (failure) setError(errorMessage(failure, "Could not add the structure."));
      if (message && structuresCreated.length > 0) setNotice(message);
      return structuresCreated;
    } finally {
      setBusy(false);
    }
  }

  async function remove(ids: string[]) {
    const wanted = new Set(ids);
    const doomed = structures.filter((structure) => wanted.has(structure.id));
    if (doomed.length === 0 || busyRef.current) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { deleted, failure } = await deleteAll(doomed);
      if (deleted.length > 0) {
        startEdit({ type: "delete", structures: deleted });
        setNotice(deleted.length === 1 ? "Structure deleted. Press Ctrl/Cmd+Z to restore it." : `${deleted.length} structures deleted. Press Ctrl/Cmd+Z to restore them.`);
      }
      if (failure) setError(errorMessage(failure, "Could not delete the structure."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Replays one history entry in the given direction. On success the entry moves to the opposite stack
   * (with recreated ids); whatever failed goes back onto the stack it came from.
   */
  async function replay(direction: "undo" | "redo") {
    const from = direction === "undo" ? undoStack : redoStack;
    const to = direction === "undo" ? redoStack : undoStack;
    if (busyRef.current || from.current.length === 0) return;
    const entry = from.current.pop()!;
    historyChanged();
    setBusy(true);
    setError("");
    setNotice("");
    const done = direction === "undo" ? "Last map edit undone." : "Map edit redone.";
    try {
      if (entry.type === "update") {
        const fields = entry.changes.map((change) => ({ id: change.id, fields: direction === "undo" ? change.before : change.after }));
        applyFields(fields);
        const { failedIds, failure } = await patchAll(fields);
        const applied = entry.changes.filter((change) => !failedIds.has(change.id));
        const failed = entry.changes.filter((change) => failedIds.has(change.id));
        if (applied.length > 0) push(to.current, { type: "update", changes: applied });
        if (failed.length > 0) {
          push(from.current, { type: "update", changes: failed });
          setError(errorMessage(failure, direction === "undo" ? "Could not undo the structure change." : "Could not redo the structure change."));
          await resync();
          return;
        }
        setNotice(done);
        return;
      }
      // Undoing a creation or redoing a deletion removes structures; the opposite recreates them.
      const recreate = (entry.type === "delete") === (direction === "undo");
      if (recreate) {
        const { created, failed, failure } = await postAll(entry.structures, restorePayload);
        remapIds(new Map(created.map(({ source, structure }) => [source.id, structure.id])));
        if (created.length > 0) push(to.current, { type: entry.type, structures: created.map(({ structure }) => structure) });
        setSelectedIds(created.map(({ structure }) => structure.id));
        if (failed.length > 0) {
          push(from.current, { type: entry.type, structures: failed });
          setError(errorMessage(failure, "Could not restore the structures."));
          await resync();
          return;
        }
      } else {
        const { deleted, failed, failure } = await deleteAll(entry.structures);
        if (deleted.length > 0) push(to.current, { type: entry.type, structures: deleted });
        if (failed.length > 0) {
          push(from.current, { type: entry.type, structures: failed });
          setError(errorMessage(failure, "Could not remove the structures."));
          await resync();
          return;
        }
      }
      setNotice(done);
    } finally {
      setBusy(false);
    }
  }

  return {
    map,
    setMap,
    structures,
    loading,
    busy,
    error,
    notice,
    setError,
    setNotice,
    setBusy,
    selectedIds,
    select,
    load,
    runSaving,
    update,
    create,
    remove,
    undo: () => replay("undo"),
    redo: () => replay("redo"),
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}

function restorePayload(structure: MapStructure): NewStructure {
  const { kind, geometry, blocks_vision, blocks_movement, blocks_attacks, cover_bonus, pass_rules, z_index, group_id } = structure;
  return { kind, geometry, blocks_vision, blocks_movement, blocks_attacks, cover_bonus, pass_rules, z_index, group_id };
}
