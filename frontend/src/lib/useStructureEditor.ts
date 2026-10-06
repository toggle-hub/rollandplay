import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, deleteJSON, patchJSON, postJSON } from "../api/client";
import type { GameMap, MapStructure } from "../api/types";
import { shortcutLabel } from "./platform";
import { expandToGroups, sortByZ } from "./structureGroups";

export type StructureFields = Partial<Pick<MapStructure, "geometry" | "kind" | "blocks_vision" | "blocks_movement" | "blocks_attacks" | "z_index" | "group_id">>;
export type StructureUpdate = { id: string; fields: StructureFields };
/** A structure to create. Without `id` it gets a fresh one; without `z_index` it goes on top. */
export type NewStructure = Omit<MapStructure, "id" | "map_id" | "z_index" | "group_id"> & Partial<Pick<MapStructure, "id" | "z_index" | "group_id">>;
/** Map settings that edits (and undo) can change. */
export type MapFields = Partial<Pick<GameMap, "name" | "width_m" | "height_m" | "grid_size_m" | "background_asset_id">>;
/** "saving" while edits are on their way to the server; "failed" when one of the last ones was refused. */
export type SaveState = "idle" | "saving" | "saved" | "failed";
export type EditorNotice = { text: string; key: number };

type FieldChange = { id: string; before: StructureFields; after: StructureFields };
type HistoryEntry =
  | { type: "update"; changes: FieldChange[] }
  | { type: "create"; structures: MapStructure[] }
  | { type: "delete"; structures: MapStructure[] }
  | { type: "map"; before: MapFields; after: MapFields };
/** The saves of one opened map. Opening another map starts a new session; the old one's results are ignored. */
type SaveSession = { mapPath: string; queue: Promise<void>; pending: number; resync: boolean; failed: boolean };

const historyLimit = 100;
const newSession = (mapId: string | undefined): SaveSession => ({ mapPath: `/api/maps/${mapId}`, queue: Promise.resolve(), pending: 0, resync: false, failed: false });
const errorMessage = (err: unknown, fallback: string) => err instanceof Error && err.message ? err.message : fallback;

/**
 * Map, selection and undo/redo history for the map editor. Every edit applies locally and to the history
 * at once, then saves in the background: saves run one after another in the order they were made, so
 * input is never blocked or dropped. When the server refuses a save, `onError` reports it, the refused part
 * leaves the history, and the map reloads from the server once the remaining saves have finished.
 */
export function useStructureEditor(mapId: string | undefined, onError: (message: string) => void) {
  const [map, setMapState] = useState<GameMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNoticeState] = useState<EditorNotice | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [, setHistoryVersion] = useState(0);
  const mapRef = useRef<GameMap | null>(null);
  const session = useRef<SaveSession>(newSession(mapId));
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const noticeKey = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const structures = useMemo(() => sortByZ(map?.structures ?? []), [map?.structures]);

  /** Keeps a synchronous copy, so edits made in one event see each other. */
  const commitMap = (next: GameMap | null) => {
    mapRef.current = next;
    setMapState(next);
  };
  const changeMap = (change: (current: GameMap) => GameMap) => {
    if (mapRef.current) commitMap(change(mapRef.current));
  };
  const currentStructures = () => mapRef.current?.structures ?? [];

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
  /** Shrinks an entry to the structures whose save went through; an entry with nothing left leaves the history. */
  const keepSaved = (entry: HistoryEntry, failedIds: ReadonlySet<string>) => {
    if (entry.type === "update") entry.changes = entry.changes.filter((change) => !failedIds.has(change.id));
    else if (entry.type !== "map") entry.structures = entry.structures.filter((structure) => !failedIds.has(structure.id));
    const empty = entry.type === "map" || (entry.type === "update" ? entry.changes.length === 0 : entry.structures.length === 0);
    if (empty) {
      undoStack.current = undoStack.current.filter((candidate) => candidate !== entry);
      redoStack.current = redoStack.current.filter((candidate) => candidate !== entry);
    }
    historyChanged();
  };

  function setNotice(text: string) {
    noticeKey.current += 1;
    setNoticeState(text ? { text, key: noticeKey.current } : null);
  }

  useEffect(() => {
    const opened = newSession(mapId);
    session.current = opened;
    undoStack.current = [];
    redoStack.current = [];
    historyChanged();
    commitMap(null);
    setSelectedIds([]);
    setSaveState("idle");
    setLoading(true);
    setLoadError("");
    apiFetch<GameMap>(opened.mapPath)
      .then((loaded) => {
        if (session.current === opened) commitMap(loaded);
      })
      .catch((err: Error) => {
        if (session.current === opened) setLoadError(err.message);
      })
      .finally(() => {
        if (session.current === opened) setLoading(false);
      });
  }, [mapId]);

  /** Queues a save behind every earlier one. A thrown error is reported and makes the map reload afterwards. */
  function enqueue(task: (mapPath: string) => Promise<void>, fallback: string) {
    const current = session.current;
    const live = () => session.current === current;
    current.pending += 1;
    setSaveState("saving");
    current.queue = current.queue
      .then(() => task(current.mapPath))
      .catch((err: unknown) => {
        current.failed = true;
        current.resync = true;
        if (live()) onErrorRef.current(errorMessage(err, fallback));
      })
      .finally(() => {
        current.pending -= 1;
        if (live() && current.pending === 0) settle(current);
      });
  }

  function settle(current: SaveSession) {
    if (current.resync) {
      current.resync = false;
      enqueue(async (mapPath) => {
        let fresh: GameMap;
        try {
          fresh = await apiFetch<GameMap>(mapPath);
        } catch (err) {
          current.failed = true;
          if (session.current === current) onErrorRef.current(`Could not reload the map: ${errorMessage(err, "network error")}`);
          return;
        }
        // Edits made while this reload ran are queued behind it; showing the reload would hide them.
        if (current.pending > 1) {
          current.resync = true;
          return;
        }
        if (session.current !== current) return;
        commitMap(fresh);
        const kept = new Set((fresh.structures ?? []).map((structure) => structure.id));
        setSelectedIds((selected) => selected.filter((id) => kept.has(id)));
      }, "Could not reload the map.");
      return;
    }
    setSaveState(current.failed ? "failed" : "saved");
    current.failed = false;
  }

  /** Resolves once every queued save has finished. */
  async function flush() {
    const current = session.current;
    while (current.pending > 0) await current.queue;
  }

  const select = (ids: string[], allowed?: (id: string) => boolean) => {
    const expanded = expandToGroups(ids, structures);
    setSelectedIds(allowed ? expanded.filter(allowed) : expanded);
  };

  const applyFields = (changes: { id: string; fields: StructureFields }[]) => {
    const next = new Map(changes.map((change) => [change.id, change.fields]));
    changeMap((current) => ({
      ...current,
      structures: current.structures?.map((structure) => {
        const fields = next.get(structure.id);
        return fields ? { ...structure, ...fields } : structure;
      }),
    }));
  };
  const addLocal = (created: MapStructure[]) =>
    changeMap((current) => ({ ...current, structures: [...(current.structures ?? []), ...created] }));
  const removeLocal = (ids: ReadonlySet<string>) => {
    changeMap((current) => ({ ...current, structures: current.structures?.filter((structure) => !ids.has(structure.id)) }));
    setSelectedIds((current) => current.filter((id) => !ids.has(id)));
  };

  /** PATCHes every change and waits for all of them, so a reload after a failure sees every write that landed. */
  async function patchAll(mapPath: string, changes: { id: string; fields: StructureFields }[]) {
    const results = await Promise.allSettled(changes.map((change) => patchJSON(`${mapPath}/structures/${change.id}`, change.fields)));
    return settledFailures(changes.map((change) => change.id), results);
  }
  async function postAll(mapPath: string, created: MapStructure[]) {
    const results = await Promise.allSettled(created.map((structure) => postJSON<MapStructure>(`${mapPath}/structures`, createPayload(structure))));
    return settledFailures(created.map((structure) => structure.id), results);
  }
  async function deleteAll(mapPath: string, doomed: MapStructure[]) {
    const results = await Promise.allSettled(doomed.map((structure) => deleteJSON(`${mapPath}/structures/${structure.id}`)));
    return settledFailures(doomed.map((structure) => structure.id), results);
  }

  function update(updates: StructureUpdate[], message?: string) {
    const current = new Map(currentStructures().map((structure) => [structure.id, structure]));
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
    if (message) setNotice(message);
    enqueue(async (mapPath) => {
      const { failedIds, failure } = await patchAll(mapPath, changes.map((change) => ({ id: change.id, fields: change.after })));
      if (failedIds.size === 0) return;
      keepSaved(entry, failedIds);
      throw failure;
    }, "Could not update the structure.");
  }

  /** Adds the structures at once and saves them in the background. Returns them with their ids. */
  function create(payloads: NewStructure[], message?: string): MapStructure[] {
    if (payloads.length === 0 || !mapRef.current) return [];
    const top = Math.max(0, ...currentStructures().map((structure) => structure.z_index ?? 0));
    const created: MapStructure[] = payloads.map((payload, index) => ({
      ...payload,
      id: payload.id ?? crypto.randomUUID(),
      map_id: mapRef.current?.id,
      z_index: payload.z_index ?? top + index + 1,
    }));
    const entry: HistoryEntry = { type: "create", structures: created };
    startEdit(entry);
    addLocal(created);
    if (message) setNotice(message);
    enqueue(async (mapPath) => {
      const { failedIds, failure } = await postAll(mapPath, created);
      if (failedIds.size === 0) return;
      keepSaved(entry, failedIds);
      throw failure;
    }, "Could not add the structure.");
    return created;
  }

  function remove(ids: string[]) {
    const wanted = new Set(ids);
    const doomed = currentStructures().filter((structure) => wanted.has(structure.id));
    if (doomed.length === 0) return;
    const entry: HistoryEntry = { type: "delete", structures: doomed };
    startEdit(entry);
    removeLocal(wanted);
    const undo = shortcutLabel("mod+z");
    setNotice(doomed.length === 1 ? `Structure deleted. Press ${undo} to restore it.` : `${doomed.length} structures deleted. Press ${undo} to restore them.`);
    enqueue(async (mapPath) => {
      const { failedIds, failure } = await deleteAll(mapPath, doomed);
      if (failedIds.size === 0) return;
      keepSaved(entry, failedIds);
      throw failure;
    }, "Could not delete the structure.");
  }

  /** Changes map settings (name, size, grid, background) as one undoable step. */
  function updateMap(fields: MapFields, message?: string) {
    const current = mapRef.current;
    if (!current) return;
    const keys = (Object.keys(fields) as (keyof MapFields)[]).filter((key) => String(fields[key] ?? "") !== String(current[key] ?? ""));
    if (keys.length === 0) return;
    const before = Object.fromEntries(keys.map((key) => [key, current[key] ?? null])) as MapFields;
    const after = Object.fromEntries(keys.map((key) => [key, fields[key] ?? null])) as MapFields;
    const entry: HistoryEntry = { type: "map", before, after };
    startEdit(entry);
    changeMap((map) => ({ ...map, ...after }));
    if (message) setNotice(message);
    enqueue(async (mapPath) => {
      try {
        await patchJSON(mapPath, after);
      } catch (err) {
        keepSaved(entry, new Set());
        throw err;
      }
    }, "Could not save the map settings.");
  }

  /**
   * Replays one history entry in the given direction. The entry moves to the opposite stack at once;
   * whatever the server refuses goes back onto the stack it came from.
   */
  function replay(direction: "undo" | "redo") {
    const undoing = direction === "undo";
    const from = undoing ? undoStack : redoStack;
    const to = undoing ? redoStack : undoStack;
    const entry = from.current.pop();
    if (!entry) return;
    push(to.current, entry);
    setNotice(undoing ? "Last map edit undone." : "Map edit redone.");
    if (entry.type === "update") {
      const fields = entry.changes.map((change) => ({ id: change.id, fields: undoing ? change.before : change.after }));
      applyFields(fields);
      enqueue(async (mapPath) => {
        const { failedIds, failure } = await patchAll(mapPath, fields);
        if (failedIds.size === 0) return;
        const failed = entry.changes.filter((change) => failedIds.has(change.id));
        keepSaved(entry, failedIds);
        push(from.current, { type: "update", changes: failed });
        throw failure;
      }, undoing ? "Could not undo the structure change." : "Could not redo the structure change.");
      return;
    }
    if (entry.type === "map") {
      const fields = undoing ? entry.before : entry.after;
      changeMap((map) => ({ ...map, ...fields }));
      enqueue(async (mapPath) => {
        try {
          await patchJSON(mapPath, fields);
        } catch (err) {
          keepSaved(entry, new Set());
          push(from.current, entry);
          throw err;
        }
      }, undoing ? "Could not undo the map settings change." : "Could not redo the map settings change.");
      return;
    }
    // Undoing a creation or redoing a deletion removes structures; the opposite recreates them with their ids.
    const recreate = (entry.type === "delete") === undoing;
    const affected = entry.structures;
    if (recreate) {
      addLocal(affected);
      setSelectedIds(affected.map((structure) => structure.id));
    } else {
      removeLocal(new Set(affected.map((structure) => structure.id)));
    }
    enqueue(async (mapPath) => {
      const { failedIds, failure } = recreate ? await postAll(mapPath, affected) : await deleteAll(mapPath, affected);
      if (failedIds.size === 0) return;
      const failed = affected.filter((structure) => failedIds.has(structure.id));
      keepSaved(entry, failedIds);
      push(from.current, { type: entry.type, structures: failed });
      throw failure;
    }, recreate ? "Could not restore the structures." : "Could not remove the structures.");
  }

  return {
    map,
    structures,
    loading,
    loadError,
    notice,
    setNotice,
    saveState,
    selectedIds,
    select,
    update,
    create,
    remove,
    updateMap,
    flush,
    undo: () => replay("undo"),
    redo: () => replay("redo"),
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}

function settledFailures(ids: string[], results: PromiseSettledResult<unknown>[]) {
  const failedIds = new Set(ids.filter((_, index) => results[index].status === "rejected"));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
  return { failedIds, failure };
}

/** The POST body that saves a structure under its own id, draw order and group. */
function createPayload(structure: MapStructure): NewStructure {
  const { id, kind, geometry, blocks_vision, blocks_movement, blocks_attacks, cover_bonus, pass_rules, z_index, group_id } = structure;
  return { id, kind, geometry, blocks_vision, blocks_movement, blocks_attacks, cover_bonus, pass_rules, z_index, ...(group_id ? { group_id } : {}) };
}
