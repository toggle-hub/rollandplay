import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowCounterClockwise, FloppyDisk, MapTrifold, PencilSimple } from "@phosphor-icons/react";
import { apiFetch, postJSON } from "../api/client";
import type { GameMap, RoomMapSummary, VisibleRoomState } from "../api/types";
import { clampStampScale, normalizeDegrees, structureTypes, type StructureBlocks } from "../lib/structures";
import { useToast } from "./Toast";

/** Runs a room change with the page's busy state, reloads the room afterwards and reports failures. */
type Run = (action: () => Promise<unknown>) => void;

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

function changeSummary({ added, moved, removed }: RoomMapSummary["table_changes"]) {
  const parts = [added && `${added} added`, moved && `${moved} moved`, removed && `${removed} removed`].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} at this table` : "";
}

/**
 * The game master's map picker. Switching maps asks first, because tokens belong to a map: the ones on the
 * current map wait there until the table switches back. It also links the active map to the map editor and
 * saves the structures changed at this table into the saved map.
 */
export function RoomMapCard({ roomId, state, maps, mapChoice, onMapChoice, busy, run }: {
  roomId: string;
  state: VisibleRoomState;
  maps: GameMap[];
  mapChoice: string;
  onMapChoice: (mapId: string) => void;
  busy: boolean;
  run: Run;
}) {
  const toast = useToast();
  const [roomMaps, setRoomMaps] = useState<RoomMapSummary[]>([]);
  const [confirming, setConfirming] = useState<"switch" | "save" | null>(null);
  const active = state.activeMap;
  const currentMapId = active?.map_id ?? "";
  // Any structure, token or map change reloads the state, and with it the counts here.
  useEffect(() => {
    apiFetch<RoomMapSummary[]>(`/api/rooms/${roomId}/maps`).then((items) => setRoomMaps(items ?? [])).catch(() => setRoomMaps([]));
  }, [roomId, state.activeMap?.id, state.structures, state.visibleTokens]);
  useEffect(() => setConfirming(null), [currentMapId, mapChoice]);

  const tokensOn = (mapId: string) => roomMaps.find((item) => item.map_id === mapId)?.token_count ?? 0;
  const activeSummary = roomMaps.find((item) => item.is_active && item.map_id === currentMapId);
  const changes = activeSummary ? changeSummary(activeSummary.table_changes) : "";
  const chosenName = maps.find((item) => item.id === mapChoice)?.name ?? "the chosen map";
  const currentTokens = activeSummary?.token_count ?? state.visibleTokens.length;

  function activate() {
    setConfirming(null);
    run(() => postJSON(`/api/rooms/${roomId}/maps`, { map_id: mapChoice, is_active: true }));
  }

  function save() {
    if (!activeSummary || !active) return;
    setConfirming(null);
    run(async () => {
      const saved = await postJSON<{ added: number; moved: number; removed: number }>(`/api/rooms/${roomId}/maps/${activeSummary.id}/save`, {});
      toast({ kind: "success", message: `Saved to ${active.name}: ${saved.added} added, ${saved.moved} moved, ${saved.removed} removed.` });
    });
  }

  return <form className="card space-y-4 p-5!" onSubmit={(event) => {
    event.preventDefault();
    if (!mapChoice || mapChoice === currentMapId) return;
    // Nothing is set aside when no map is active yet.
    if (currentMapId) setConfirming("switch");
    else activate();
  }}>
    <h2 className="flex items-center gap-2 text-xl"><MapTrifold size={22} className="text-[var(--accent)]" aria-hidden="true" />Room map</h2>
    <label className="field-label block" htmlFor="room-map">Active map</label>
    <div className="flex flex-col gap-3">
      <select id="room-map" className="w-full min-w-0" value={mapChoice} onChange={(e) => onMapChoice(e.target.value)}>
        <option value="">Choose a map</option>
        {maps.map((item) => {
          const tokens = tokensOn(item.id);
          return <option key={item.id} value={item.id}>{`${item.name}${item.id === currentMapId ? " (active)" : ""}${tokens ? ` · ${plural(tokens, "token")}` : ""}`}</option>;
        })}
      </select>
      <button className="btn-secondary shrink-0" disabled={!mapChoice || mapChoice === currentMapId || busy || confirming === "switch"}>{busy ? "Saving…" : "Set active map"}</button>
    </div>
    {confirming === "switch" && <div className="space-y-3 rounded-lg border border-[var(--peach)]/40 bg-[var(--input)] p-3 text-sm" role="alertdialog" aria-label="Switch the active map?">
      <p>{`Switch to ${chosenName}? ${currentTokens ? `The ${plural(currentTokens, "token")} on ${active?.name ?? "the current map"} will be set aside until you switch back.` : `${active?.name ?? "The current map"} has no tokens.`}${tokensOn(mapChoice) ? ` ${chosenName} has ${plural(tokensOn(mapChoice), "token")} waiting.` : ""}`}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => setConfirming(null)}>Keep current map</button>
        <button className="btn min-h-9 px-3 py-1.5 text-xs" type="button" autoFocus onClick={activate}>Switch map</button>
      </div>
    </div>}
    {maps.length === 0 && <p className="text-muted text-sm">No saved maps yet. Start a blank map below, or <Link className="text-[var(--accent)] underline underline-offset-4" to="/maps">create one in Maps</Link>.</p>}
    {active && activeSummary?.can_edit && <div className="space-y-3 border-t border-[var(--paper)]/10 pt-3">
      <Link className="inline-flex items-center gap-2 text-sm text-[var(--accent)] underline underline-offset-4 hover:text-[var(--paper)]" to={`/maps/${active.map_id}/edit`}><PencilSimple size={16} aria-hidden="true" />Open in map editor</Link>
      <p className="text-muted text-sm">{changes || "No unsaved structure changes at this table."}</p>
      <button className="btn-secondary w-full" type="button" disabled={!changes || busy || confirming === "save"} onClick={() => setConfirming("save")}><FloppyDisk size={18} aria-hidden="true" />Save table changes to map</button>
      {confirming === "save" && <div className="space-y-3 rounded-lg border border-[var(--peach)]/40 bg-[var(--input)] p-3 text-sm" role="alertdialog" aria-label="Save table changes to the map?">
        <p>{`Save ${changes.replace(" at this table", "")} into ${active.name}? The map editor and every room using this map will get them. Hidden structures and open doors stay at this table.`}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => setConfirming(null)}>Cancel</button>
          <button className="btn min-h-9 px-3 py-1.5 text-xs" type="button" autoFocus onClick={save}>Save to map</button>
        </div>
      </div>}
    </div>}
  </form>;
}

/** Starts an empty map in the game master's library and makes it active here. */
export function BlankMapCard({ roomId, roomName, busy, run, onCreated }: { roomId: string; roomName: string; busy: boolean; run: Run; onCreated: (mapId: string) => void }) {
  const [form, setForm] = useState({ name: "", width: "30", height: "30", grid: "1.5" });

  function start(event: FormEvent) {
    event.preventDefault();
    const body = { name: form.name.trim() || undefined, width_m: Number(form.width), height_m: Number(form.height), grid_size_m: Number(form.grid) };
    run(async () => {
      const created = await postJSON<GameMap>(`/api/rooms/${roomId}/maps/new`, body);
      onCreated(created.id);
      setForm((current) => ({ ...current, name: "" }));
    });
  }

  return <form className="card space-y-3 p-5!" onSubmit={start}>
    <h2 className="text-xl">Start a blank map</h2>
    <p className="text-muted text-sm">Creates an empty map in your library and makes it active here right away.</p>
    <label className="field-label block" htmlFor="room-blank-map-name">Map name <span className="text-muted font-normal">(optional)</span></label>
    <input id="room-blank-map-name" className="w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`${roomName} map`} />
    <div className="grid grid-cols-3 gap-3">
      <div>
        <label className="field-label block" htmlFor="room-blank-map-width">Width (m)</label>
        <input id="room-blank-map-width" className="w-full" type="number" min="1" max="1000" step="1" required value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
      </div>
      <div>
        <label className="field-label block" htmlFor="room-blank-map-height">Height (m)</label>
        <input id="room-blank-map-height" className="w-full" type="number" min="1" max="1000" step="1" required value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
      </div>
      <div>
        <label className="field-label block" htmlFor="room-blank-map-grid">Grid (m)</label>
        <input id="room-blank-map-grid" className="w-full" type="number" min="0.25" max="1000" step="0.25" required value={form.grid} onChange={(e) => setForm({ ...form, grid: e.target.value })} />
      </div>
    </div>
    <p className="text-muted text-xs">A 1.5 m square is the usual 5-foot square.</p>
    <button className="btn-secondary w-full" disabled={busy}>{busy ? "Saving…" : "Start blank map"}</button>
  </form>;
}

export type PlacementStamp = { rotationDeg: number; scalePercent: number };

/** The rotation and size of the next placed structure. While placing, Q/E rotate it by 15° and [ and ] resize it by 10%. */
export function usePlacementStamp(placing: boolean) {
  const [stamp, setStamp] = useState<PlacementStamp>({ rotationDeg: 0, scalePercent: 100 });
  useEffect(() => {
    if (!placing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      const key = event.key.toLowerCase();
      if (key === "q" || key === "e") setStamp((current) => ({ ...current, rotationDeg: normalizeDegrees(current.rotationDeg + (key === "q" ? -15 : 15)) }));
      else if (key === "[" || key === "]") setStamp((current) => ({ ...current, scalePercent: clampStampScale(current.scalePercent + (key === "[" ? -10 : 10)) }));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placing]);
  return [stamp, setStamp] as const;
}

/** In-room building: what gets placed, how it is turned and sized, and Undo for the last structure change. */
export function StructureToolsCard({ hasMap, kind, onKind, blocks, onBlocks, placing, onTogglePlacing, stamp, onStamp, undoLabel, canUndo, onUndo }: {
  hasMap: boolean;
  kind: string;
  onKind: (kind: string) => void;
  blocks: StructureBlocks;
  onBlocks: (blocks: StructureBlocks) => void;
  placing: boolean;
  onTogglePlacing: () => void;
  stamp: PlacementStamp;
  onStamp: (stamp: PlacementStamp) => void;
  /** What Undo reverses, such as "removed wall"; undefined when there is nothing to undo. */
  undoLabel?: string;
  canUndo: boolean;
  onUndo: () => void;
}) {
  return <div className="card space-y-3 p-5!">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-xl">Place structure</h2>
      <span className="rounded-full border border-[var(--peach)]/40 px-2 py-0.5 text-xs text-[var(--peach)]">This table only</span>
    </div>
    <p className="text-muted text-sm">{hasMap ? "Walls and doors placed, moved or removed here change only this table until you save them to the map." : "No map yet. Placing a structure starts a blank 30 × 30 m map for this room."}</p>
    <label className="field-label block" htmlFor="room-structure-kind">Structure type</label>
    <select id="room-structure-kind" className="w-full min-w-0" value={kind} onChange={(e) => onKind(e.target.value)}>
      {structureTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
    </select>
    <fieldset className="space-y-2">
      <legend className="field-label">This structure blocks</legend>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blocks.blocks_vision} onChange={(e) => onBlocks({ ...blocks, blocks_vision: e.target.checked })} />Line of sight</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blocks.blocks_movement} onChange={(e) => onBlocks({ ...blocks, blocks_movement: e.target.checked })} />Movement</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={blocks.blocks_attacks} onChange={(e) => onBlocks({ ...blocks, blocks_attacks: e.target.checked })} />Attacks</label>
    </fieldset>
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="field-label block" htmlFor="room-stamp-rotation">Rotation (°)</label>
        <input id="room-stamp-rotation" className="w-full" type="number" step="15" value={stamp.rotationDeg} onChange={(e) => onStamp({ ...stamp, rotationDeg: normalizeDegrees(Number(e.target.value) || 0) })} />
      </div>
      <div>
        <label className="field-label block" htmlFor="room-stamp-scale">Size (%)</label>
        <input id="room-stamp-scale" className="w-full" type="number" min="10" max="1000" step="10" value={stamp.scalePercent} onChange={(e) => onStamp({ ...stamp, scalePercent: clampStampScale(Number(e.target.value) || 100) })} />
      </div>
    </div>
    <p className="text-muted text-xs">While placing, Q and E rotate by 15°, [ and ] resize by 10%.</p>
    <button className={placing ? "btn-secondary w-full" : "btn w-full"} type="button" aria-pressed={placing} onClick={onTogglePlacing}>{placing ? "Stop placing" : "Place on map"}</button>
    <button className="btn-secondary w-full" type="button" disabled={!canUndo} title="Ctrl+Z" onClick={onUndo}>
      <ArrowCounterClockwise size={18} aria-hidden="true" />{undoLabel ? `Undo ${undoLabel}` : "Undo last change"}
    </button>
  </div>;
}
