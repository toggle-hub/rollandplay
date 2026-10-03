import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowsIn, ArrowsOut, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { apiFetch, deleteJSON, patchJSON, postJSON } from "../api/client";
import { useSession } from "../auth/SessionContext";
import { MapEditorCanvas, type StructureGeometryChange } from "../components/MapEditorCanvas";
import { geometryBounds, geometryCenter, nudgeGeometry, scaleGeometry, type Point } from "../lib/geometryTransforms";
import type { GameMap, MapStructure } from "../api/types";
import { defaultBlocksForKind, snap, structureLabel, structureTypes, templateGeometry, wallBlocks, type StructureBlocks } from "../lib/structures";

type DraftSnapshot = { geometry: string; selectedStructureIds: string[] };
type GeometryChange = { id: string; before: Point[]; after: Point[] };
type UndoEntry =
  | { type: "draft-geometry"; before: DraftSnapshot }
  | { type: "structure-geometry"; changes: GeometryChange[] }
  | { type: "structures-deleted"; structures: MapStructure[] };

export function MapEditorPage() {
  const { mapId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [map, setMap] = useState<GameMap | null>(null);
  const [geometry, setGeometry] = useState('[{"x":4,"y":4},{"x":10,"y":4}]');
  const [kind, setKind] = useState("wall");
  const [blocks, setBlocks] = useState<StructureBlocks>(wallBlocks);
  const [selectedStructureIds, setSelectedStructureIds] = useState<string[]>([]);
  const [asset, setAsset] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmingMapDelete, setConfirmingMapDelete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const undoHistory = useRef<UndoEntry[]>([]);

  const load = async () => setMap(await apiFetch<GameMap>(`/api/maps/${mapId}`));
  const resync = () => load().catch(() => undefined);
  const draftGeometry = parsePoints(geometry);
  const draftStructure = draftGeometry ? structurePayload(kind, draftGeometry, blocks) : null;
  const structures = map?.structures ?? [];
  const selectedStructures = structures.filter((structure) => selectedStructureIds.includes(structure.id));
  const transformGeometry = selectedStructures.length > 0 ? selectedStructures.flatMap((structure) => structure.geometry) : draftGeometry;
  const transformBounds = transformGeometry ? geometryBounds(transformGeometry) : null;
  const transformTarget = selectedStructures.length > 1
    ? `${selectedStructures.length} structures`
    : selectedStructures.length === 1 ? `${selectedStructures[0].kind} layer` : "draft structure";
  const mapJSON = map ? JSON.stringify({ ...map, structures }, null, 2) : "";
  const isOwner = session.status === "authenticated" && map?.owner_id === session.user.id;

  function rememberUndo(entry: UndoEntry) {
    undoHistory.current.push(entry);
    if (undoHistory.current.length > 100) undoHistory.current.shift();
  }

  function forgetUndo(entry: UndoEntry) {
    const index = undoHistory.current.indexOf(entry);
    if (index !== -1) undoHistory.current.splice(index, 1);
  }

  /** Restored structures get new ids; older undo steps must follow them. */
  function remapUndoIds(ids: Map<string, string>) {
    const remap = (id: string) => ids.get(id) ?? id;
    undoHistory.current = undoHistory.current.map((entry) => {
      if (entry.type === "structure-geometry") return { ...entry, changes: entry.changes.map((change) => ({ ...change, id: remap(change.id) })) };
      if (entry.type === "draft-geometry") return { ...entry, before: { ...entry.before, selectedStructureIds: entry.before.selectedStructureIds.map(remap) } };
      return { ...entry, structures: entry.structures.map((structure) => ({ ...structure, id: remap(structure.id) })) };
    });
  }

  function rememberDraftGeometry(before: DraftSnapshot, after: DraftSnapshot) {
    if (before.geometry === after.geometry && sameIds(before.selectedStructureIds, after.selectedStructureIds)) return;
    rememberUndo({ type: "draft-geometry", before });
  }

  function selectKind(nextKind: string) {
    setKind(nextKind);
    setBlocks(defaultBlocksForKind(nextKind));
    if (draftGeometry) setGeometry(JSON.stringify(templateGeometry(nextKind, geometryCenter(draftGeometry), Number(map?.grid_size_m || 1))));
    setSelectedStructureIds([]);
  }

  function selectLayer(structureId: string, additive: boolean) {
    setSelectedStructureIds((current) => !additive
      ? [structureId]
      : current.includes(structureId) ? current.filter((id) => id !== structureId) : [...current, structureId]);
  }

  useEffect(() => {
    undoHistory.current = [];
    setSelectedStructureIds([]);
    setLoading(true);
    setError("");
    load().catch((err: Error) => setError(err.message)).finally(() => setLoading(false));
  }, [mapId]);

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || (!event.ctrlKey && !event.metaKey) || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      if (busy || undoHistory.current.length === 0) return;
      event.preventDefault();
      undoLastChange();
    };
    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [busy, mapId]);

  async function save(action: () => Promise<unknown>, message: string) {
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

  function add(e: FormEvent) {
    e.preventDefault();
    addStructure();
  }

  function addStructure() {
    const points = parsePoints(geometry);
    if (!points) {
      setError("Geometry must be valid JSON: an array of points with x and y coordinates.");
      return;
    }
    void save(() => postJSON(`/api/maps/${mapId}/structures`, structurePayload(kind, points, blocks)), "Structure added.");
  }

  function upload() {
    if (!asset) return;
    void save(async () => {
      const form = new FormData();
      form.append("file", asset);
      form.append("name", asset.name);
      form.append("kind", "map_background");
      const result = await apiFetch<{ id: string }>("/api/assets", { method: "POST", body: form });
      await patchJSON(`/api/maps/${mapId}`, { background_asset_id: result.id });
    }, "Background uploaded and attached to this map.");
  }

  function setStructureGeometries(changes: StructureGeometryChange[]) {
    const next = new Map(changes.map((change) => [change.id, change.geometry]));
    setMap((current) => current ? {
      ...current,
      structures: current.structures?.map((structure) => {
        const geometry = next.get(structure.id);
        return geometry ? { ...structure, geometry } : structure;
      }),
    } : current);
  }

  function patchStructureGeometries(changes: StructureGeometryChange[]) {
    return Promise.all(changes.map((change) => patchJSON(`/api/maps/${mapId}/structures/${change.id}`, { geometry: change.geometry })));
  }

  function commitStructureTransforms(changes: StructureGeometryChange[]) {
    if (busy) return;
    const previous = new Map(structures.map((structure) => [structure.id, structure.geometry]));
    const geometryChanges = changes.flatMap((change) => {
      const before = previous.get(change.id);
      return before ? [{ id: change.id, before: clonePoints(before), after: clonePoints(change.geometry) }] : [];
    });
    if (geometryChanges.length === 0) return;
    const undoEntry: UndoEntry = { type: "structure-geometry", changes: geometryChanges };
    rememberUndo(undoEntry);
    setStructureGeometries(geometryChanges.map((change) => ({ id: change.id, geometry: change.after })));
    setBusy(true);
    setError("");
    void patchStructureGeometries(geometryChanges.map((change) => ({ id: change.id, geometry: change.after })))
      .catch(async (err: unknown) => {
        forgetUndo(undoEntry);
        setStructureGeometries(geometryChanges.map((change) => ({ id: change.id, geometry: change.before })));
        setError(err instanceof Error ? err.message : "Could not transform the structure.");
        await resync();
      })
      .finally(() => setBusy(false));
  }

  async function deleteSelectedStructures() {
    const doomed = selectedStructures;
    if (doomed.length === 0 || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const results = await Promise.allSettled(doomed.map((structure) => deleteJSON(`/api/maps/${mapId}/structures/${structure.id}`)));
    const deleted = doomed.filter((_, index) => results[index].status === "fulfilled");
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (deleted.length > 0) {
      const gone = new Set(deleted.map((structure) => structure.id));
      rememberUndo({ type: "structures-deleted", structures: deleted });
      setMap((current) => current ? { ...current, structures: current.structures?.filter((structure) => !gone.has(structure.id)) } : current);
      setSelectedStructureIds((current) => current.filter((id) => !gone.has(id)));
      setNotice(deleted.length === 1 ? "Structure deleted. Press Ctrl/Cmd+Z to restore it." : `${deleted.length} structures deleted. Press Ctrl/Cmd+Z to restore them.`);
    }
    if (failure) setError(failure.reason instanceof Error ? failure.reason.message : "Could not delete the structure.");
    setBusy(false);
  }

  function undoLastChange() {
    const entry = undoHistory.current.pop();
    if (!entry) return;
    setError("");
    if (entry.type === "draft-geometry") {
      setGeometry(entry.before.geometry);
      setSelectedStructureIds(entry.before.selectedStructureIds);
      setNotice("Last map edit undone.");
      return;
    }
    setBusy(true);
    setNotice("");
    if (entry.type === "structures-deleted") {
      void Promise.allSettled(entry.structures.map((structure) => postJSON<MapStructure>(`/api/maps/${mapId}/structures`, restorePayload(structure))))
        .then(async (results) => {
          const restoredIds = new Map<string, string>();
          const failed: MapStructure[] = [];
          let failure: unknown;
          results.forEach((result, index) => {
            if (result.status === "fulfilled") restoredIds.set(entry.structures[index].id, result.value.id);
            else {
              failed.push(entry.structures[index]);
              failure = result.reason;
            }
          });
          remapUndoIds(restoredIds);
          if (failed.length > 0) {
            rememberUndo({ type: "structures-deleted", structures: failed });
            setError(failure instanceof Error ? failure.message : "Could not restore the deleted structures.");
          }
          await resync();
          setSelectedStructureIds([...restoredIds.values()]);
          if (failed.length === 0) setNotice("Last map edit undone.");
        })
        .finally(() => setBusy(false));
      return;
    }
    setStructureGeometries(entry.changes.map((change) => ({ id: change.id, geometry: change.before })));
    void patchStructureGeometries(entry.changes.map((change) => ({ id: change.id, geometry: change.before })))
      .then(() => setNotice("Last map edit undone."))
      .catch(async (err: unknown) => {
        rememberUndo(entry);
        setError(err instanceof Error ? err.message : "Could not undo the structure change.");
        await resync();
      })
      .finally(() => setBusy(false));
  }

  function scaleSelection(factor: number) {
    if (selectedStructures.length > 0) {
      const center = geometryCenter(selectedStructures.flatMap((structure) => structure.geometry));
      commitStructureTransforms(selectedStructures.map((structure) => ({ id: structure.id, geometry: scaleGeometry(structure.geometry, factor, center) })));
      return;
    }
    if (!draftGeometry) return;
    const serialized = JSON.stringify(scaleGeometry(draftGeometry, factor));
    rememberDraftGeometry(
      { geometry, selectedStructureIds },
      { geometry: serialized, selectedStructureIds },
    );
    setGeometry(serialized);
  }

  function moveDraft(point: Point) {
    if (!draftGeometry) return;
    const center = geometryCenter(draftGeometry);
    const grid = Number(map?.grid_size_m || 1);
    const target = { x: snap(point.x, grid), y: snap(point.y, grid) };
    const serialized = JSON.stringify(nudgeGeometry(draftGeometry, target.x - center.x, target.y - center.y));
    rememberDraftGeometry(
      { geometry, selectedStructureIds },
      { geometry: serialized, selectedStructureIds: [] },
    );
    setSelectedStructureIds([]);
    setGeometry(serialized);
    setNotice(`${kind[0].toUpperCase() + kind.slice(1)} draft moved.`);
  }

  async function deleteMap() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteJSON(`/api/maps/${mapId}`);
      navigate("/maps");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the map.");
      setConfirmingMapDelete(false);
      setBusy(false);
    }
  }

  function exportMapJSON() {
    if (!map) return;
    setError("");
    const blob = new Blob([mapJSON], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(map.name)}.map.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Map JSON exported.");
  }

  function importDraftFromFile(file: File | null | undefined) {
    if (!file) return;
    setError("");
    setNotice("");
    const reader = new FileReader();
    reader.onload = () => {
      const nextGeometry = parsePoints(String(reader.result ?? ""));
      if (!nextGeometry) {
        setNotice("");
        setError("Imported geometry must be JSON: an array of points with x and y coordinates.");
        return;
      }
      const serialized = JSON.stringify(nextGeometry);
      rememberDraftGeometry(
        { geometry, selectedStructureIds },
        { geometry: serialized, selectedStructureIds: [] },
      );
      setSelectedStructureIds([]);
      setGeometry(serialized);
      setNotice("Draft geometry imported from JSON.");
    };
    reader.readAsText(file);
  }

  if (loading) return <div className="card" role="status">Opening map editor…</div>;
  if (!map) return <div className="card space-y-4"><p role="alert" className="text-[var(--pink)]">Could not open this map: {error}</p><Link className="btn-secondary" to="/maps">Back to maps</Link></div>;

  return <div className="map-studio workspace-page">
    <header className="map-studio-hero">
      <div>
        <Link className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--paper)]" to="/maps"><ArrowLeft size={16} aria-hidden="true" />All maps</Link>
        <p className="eyebrow">Cartographer studio</p>
        <h1 className="page-heading break-words">{map.name}</h1>
        <p className="page-description">Build directly on the canvas: select one structure or a whole area, then move, resize and rotate it with on-canvas handles. JSON import/export stays available.</p>
      </div>
      <div className="map-studio-stats" aria-label="Map summary">
        <span><strong>{map.width_m} × {map.height_m}</strong> meters</span>
        <span><strong>{map.grid_size_m}</strong> m grid</span>
        <span><strong>{structures.length}</strong> layers</span>
      </div>
    </header>

    {(error || notice) && <div
      className="grid gap-1 border-y border-[var(--paper)]/10 py-3 text-sm"
      data-testid="map-editor-feedback"
      aria-live="polite"
      aria-atomic="true"
    >
      {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
      {notice && <p role="status" className="text-[var(--green)]">{notice}</p>}
    </div>}

    <section className="map-studio-canvas-card card min-w-0">
      <div className="map-studio-canvas-head">
        <div>
          <h2 className="text-2xl">World canvas</h2>
          <p className="text-muted mt-2 text-sm">Click a structure to select it, Shift-click to add more, or drag across empty space to select an area. Drag the selection to move it, drag a square corner to resize, or drag the round handle above it to rotate; hold Shift to snap rotation to 15°. Press Delete to remove the selection and Escape to clear it. With nothing selected, click empty space to place the draft. Drag with the right or middle mouse button (or hold Space) to pan, hold Ctrl while scrolling to zoom, and press Ctrl/Cmd+Z to undo.</p>
        </div>
        <div className="map-studio-tool-chips" aria-label="Active editor state">
          <span>Brush: {structureLabel(kind)}</span>
          <span>{selectedStructures.length > 1 ? `Group: ${selectedStructures.length} layers` : selectedStructures.length === 1 ? `Layer: ${selectedStructures[0].kind}` : "Draft layer"}</span>
          {!draftGeometry && <span className="text-[var(--pink)]">Invalid draft JSON</span>}
        </div>
      </div>
      <MapEditorCanvas
        map={map}
        structures={structures}
        draftStructure={draftStructure}
        selectedStructureIds={selectedStructureIds}
        controls={<div className="grid gap-2" data-testid="map-structure-controls">
          <div className="border-b border-[var(--paper)]/10 pb-2">
            <h3 className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Transform</h3>
            <p className="mt-1 truncate px-1 text-[11px] text-[var(--paper)]" title={transformGeometry ? transformTarget : "valid draft geometry or selected structure"}>{transformGeometry ? transformTarget : "No target"}</p>
            {transformBounds && <p className="text-muted mt-0.5 px-1 text-[10px] tabular-nums">{transformBounds.width} × {transformBounds.height} m</p>}
          </div>
          <div className="grid gap-1.5" role="group" aria-label="Resize selected structures">
            <span className="px-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Size</span>
            <div className="grid grid-cols-2 gap-1">
              <button className="btn-secondary flex h-9 min-h-0 w-full items-center gap-1 px-1 py-1.5 text-[10px]" type="button" disabled={!transformGeometry || busy} aria-label="Shrink 10%" title="Shrink 10%" onClick={() => scaleSelection(0.9)}><ArrowsIn size={15} aria-hidden="true" /><span>10%</span></button>
              <button className="btn-secondary flex h-9 min-h-0 w-full items-center gap-1 px-1 py-1.5 text-[10px]" type="button" disabled={!transformGeometry || busy} aria-label="Grow 10%" title="Grow 10%" onClick={() => scaleSelection(1.1)}><ArrowsOut size={15} aria-hidden="true" /><span>10%</span></button>
            </div>
          </div>
          <button className="btn-secondary flex h-9 min-h-0 w-full items-center justify-center gap-1.5 px-1 py-1.5 text-[11px] text-[var(--pink)]" type="button" disabled={selectedStructures.length === 0 || busy} aria-label="Delete selected structures" title="Delete selected structures (Delete key)" onClick={() => void deleteSelectedStructures()}><Trash size={15} aria-hidden="true" /><span>Delete</span></button>
        </div>}
        selector={<StructurePalette
          structures={structures}
          selectedKind={kind}
          selectedStructureIds={selectedStructureIds}
          addDisabled={busy || !draftGeometry}
          onAdd={addStructure}
          onSelect={selectKind}
          onSelectStructure={selectLayer}
        />}
        disabled={busy}
        onSelectStructures={setSelectedStructureIds}
        onTransformDraft={(nextGeometry) => setGeometry(JSON.stringify(nextGeometry))}
        onTransformDraftEnd={(originalGeometry, nextGeometry) => rememberDraftGeometry(
          { geometry: JSON.stringify(originalGeometry), selectedStructureIds },
          { geometry: JSON.stringify(nextGeometry), selectedStructureIds },
        )}
        onTransformStructures={commitStructureTransforms}
        onMoveDraft={moveDraft}
        onDeleteSelection={() => void deleteSelectedStructures()}
      />
    </section>

    <div className="map-studio-dock">
      <section className="card min-w-0 space-y-5">
        <h2 className="text-2xl">Map settings</h2>
        <p className="text-muted text-sm">Name, dimensions, and grid changes save when you leave a field.</p>
        <label className="field-label block" htmlFor="map-name">Map name</label>
        <input id="map-name" className="w-full" defaultValue={map.name} disabled={busy} onBlur={(e) => { if (e.target.value !== map.name) void save(() => patchJSON(`/api/maps/${mapId}`, { name: e.target.value }), "Map name saved."); }} />
        <div className="grid grid-cols-2 gap-3">
          <label className="field-label" htmlFor="map-width">
            Width (meters)
            <input id="map-width" className="w-full" type="number" min="0.1" step="any" defaultValue={Number(map.width_m)} disabled={busy} onBlur={(e) => { const value = Number(e.target.value); if (value !== Number(map.width_m) && e.target.validity.valid && value > 0) void save(() => patchJSON(`/api/maps/${mapId}`, { width_m: value }), "Map width saved."); }} />
          </label>
          <label className="field-label" htmlFor="map-height">
            Height (meters)
            <input id="map-height" className="w-full" type="number" min="0.1" step="any" defaultValue={Number(map.height_m)} disabled={busy} onBlur={(e) => { const value = Number(e.target.value); if (value !== Number(map.height_m) && e.target.validity.valid && value > 0) void save(() => patchJSON(`/api/maps/${mapId}`, { height_m: value }), "Map height saved."); }} />
          </label>
        </div>
        <label className="field-label block" htmlFor="map-grid">Grid size (meters)</label>
        <input id="map-grid" className="w-full" type="number" min="0.1" step="any" defaultValue={Number(map.grid_size_m)} disabled={busy} onBlur={(e) => { const value = Number(e.target.value); if (value !== Number(map.grid_size_m) && e.target.validity.valid && value > 0) void save(() => patchJSON(`/api/maps/${mapId}`, { grid_size_m: value }), "Grid size saved."); }} />
        <div className="border-t border-[var(--paper)]/10 pt-5">
          <label className="field-label mb-3 block" htmlFor="map-background">Background image</label>
          <input id="map-background" type="file" accept="image/*" className="w-full max-w-full text-sm" onChange={(e) => setAsset(e.target.files?.[0] ?? null)} />
          <p className="text-muted mt-3 text-xs">{map.background_asset_id ? "A background is attached. Upload another image to replace it." : "Add an image to use as this map’s background."}</p>
          <button className="btn-secondary mt-4" type="button" disabled={!asset || busy} onClick={upload}><UploadSimple size={18} aria-hidden="true" />Upload background</button>
        </div>
        {isOwner && <div className="border-t border-[var(--paper)]/10 pt-5">
          <h3 className="field-label mb-3">Delete map</h3>
          <p className="text-muted text-xs">Removes this map and every structure on it. A map attached to a room can’t be deleted.</p>
          {confirmingMapDelete ? <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="mr-auto text-sm text-[var(--pink)]">Delete “{map.name}” permanently?</span>
            <button className="btn-secondary text-[var(--pink)]" type="button" disabled={busy} onClick={() => void deleteMap()}>{busy ? "Deleting…" : "Confirm"}</button>
            <button className="btn-secondary" type="button" disabled={busy} onClick={() => setConfirmingMapDelete(false)}>Cancel</button>
          </div> : <button className="btn-secondary mt-4" type="button" disabled={busy} onClick={() => setConfirmingMapDelete(true)}><Trash size={18} aria-hidden="true" />Delete map</button>}
        </div>}
      </section>

      <form className="card space-y-5" onSubmit={add}>
        <h2 className="text-2xl">Draft structure</h2>
        <label className="field-label block" htmlFor="structure-kind">Structure type</label>
        <select id="structure-kind" className="w-full" value={kind} onChange={(e) => selectKind(e.target.value)}>{structureTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
        <label className="field-label block" htmlFor="structure-geometry">Geometry (JSON)</label>
        <textarea id="structure-geometry" className="min-h-40 w-full font-mono text-sm" spellCheck={false} value={geometry} onChange={(e) => setGeometry(e.target.value)} aria-describedby="geometry-help" />
        <p id="geometry-help" className="text-muted text-xs">Import or edit an array of x/y points in meters. Dragging the draft on the canvas exports back into this JSON.</p>
        <fieldset className="space-y-3">
          <legend className="field-label mb-3">This structure blocks</legend>
          {(["blocks_vision", "blocks_movement", "blocks_attacks"] as const).map((key) => <label className="flex items-center gap-3 text-sm" key={key}><input type="checkbox" checked={blocks[key]} onChange={(e) => setBlocks({ ...blocks, [key]: e.target.checked })} />{key === "blocks_vision" ? "Line of sight" : key === "blocks_movement" ? "Movement" : "Attacks"}</label>)}
        </fieldset>
        <button className="btn w-full" disabled={busy || !draftGeometry}><Plus size={18} aria-hidden="true" />{busy ? "Saving…" : "Add structure"}</button>
      </form>

      <section className="card min-w-0 space-y-5">
        <h2 className="text-2xl">JSON import/export</h2>
        <p className="text-muted text-sm">Export the whole saved map, or import draft geometry without losing the direct JSON workflow.</p>
        <label className="field-label block" htmlFor="geometry-import">Import draft geometry JSON</label>
        <input id="geometry-import" type="file" accept="application/json,.json" className="w-full max-w-full text-sm" onChange={(e) => importDraftFromFile(e.target.files?.[0])} />
        <button className="btn-secondary w-full" type="button" onClick={exportMapJSON}>Export map JSON</button>
        <pre className="max-h-64 rounded-lg border border-[var(--paper)]/10 bg-[var(--input)] p-3 text-xs text-[var(--paper)]">{mapJSON}</pre>
      </section>
    </div>
  </div>;
}

function StructurePalette({
  structures,
  selectedKind,
  selectedStructureIds,
  addDisabled,
  onAdd,
  onSelect,
  onSelectStructure,
}: {
  structures: MapStructure[];
  selectedKind: string;
  selectedStructureIds: string[];
  addDisabled: boolean;
  onAdd: () => void;
  onSelect: (kind: string) => void;
  onSelectStructure: (structureId: string, additive: boolean) => void;
}) {
  return <div className="flex h-full min-h-0 flex-col" data-testid="map-structure-palette">
    <div className="shrink-0 border-b border-[var(--paper)]/10 px-3 py-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Brushes</h3>
      <p className="text-muted mt-1 text-[11px] leading-relaxed">Choose a type, then click empty canvas space to position its draft without changing its shape or angle.</p>
      <button className="btn mt-3 w-full" type="button" disabled={addDisabled} onClick={onAdd}>
        <Plus size={16} aria-hidden="true" />
        Place {structureLabel(selectedKind)}
      </button>
    </div>
    <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto overscroll-contain p-2" aria-label="Brush choices">
      {structureTypes.map((type) => {
        const selected = selectedKind === type.value;
        return <button
          key={type.value}
          type="button"
          aria-pressed={selected}
          className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-[var(--accent)]/90 bg-[var(--accent)]/15" : "border-[var(--paper)]/10 bg-[var(--input)]/85 hover:border-[var(--muted)]/70"}`}
          onClick={() => onSelect(type.value)}
        >
          <span className="flex items-center gap-2 text-sm text-[var(--paper)]"><span className={`h-2.5 w-2.5 rounded-full ${type.swatch}`} aria-hidden="true" />{type.label}</span>
          <span className="text-muted mt-1 block text-[11px]">{type.hint}</span>
        </button>;
      })}
    </div>
    <div className="min-h-0 shrink-0 border-t border-[var(--paper)]/10 px-3 py-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Layers</h3>
      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
        {structures.length === 0 && <p className="text-muted text-[11px] leading-relaxed">Saved layers appear here after adding a structure.</p>}
        {structures.map((structure, index) => {
          const selected = selectedStructureIds.includes(structure.id);
          return <button
            key={structure.id}
            type="button"
            aria-pressed={selected}
            className={`w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${selected ? "border-[var(--accent)]/90 bg-[var(--accent)]/15 text-[var(--paper)]" : "border-[var(--paper)]/10 bg-[var(--input)]/85 text-[var(--paper)] hover:border-[var(--muted)]/70"}`}
            onClick={(event) => onSelectStructure(structure.id, event.shiftKey || event.ctrlKey || event.metaKey)}
          >
            <span className="block">{index + 1}. {structureLabel(structure.kind)}</span>
            <span className="text-muted mt-0.5 block text-[10px]">{structure.geometry.length} points</span>
          </button>;
        })}
      </div>
    </div>
  </div>;
}

function parsePoints(raw: string): Point[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const points = parsed.map((point) => {
      if (!point || typeof point !== "object" || !("x" in point) || !("y" in point)) throw new Error("bad point");
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("bad point");
      return { x, y };
    });
    return points.length > 0 ? points : null;
  } catch {
    return null;
  }
}

function structurePayload(kind: string, geometry: Point[], blocks: StructureBlocks) {
  return { kind, geometry, ...blocks, cover_bonus: 0, pass_rules: {} };
}

function restorePayload(structure: MapStructure) {
  const { kind, geometry, blocks_vision, blocks_movement, blocks_attacks, cover_bonus, pass_rules } = structure;
  return { kind, geometry, blocks_vision, blocks_movement, blocks_attacks, cover_bonus, pass_rules };
}

function clonePoints(points: Point[]) {
  return points.map((point) => ({ ...point }));
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function safeFileName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "map";
}
