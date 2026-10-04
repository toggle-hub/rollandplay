import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { apiFetch, deleteJSON, patchJSON } from "../api/client";
import { useSession } from "../auth/SessionContext";
import type { MapStructure } from "../api/types";
import type { EditorAction } from "../components/EditorContextMenu";
import { MapEditorCanvas, type EditorTool } from "../components/MapEditorCanvas";
import { EditorToolbar, LayersList, PlacePanel, SelectionPanel, type SelectionCommands } from "../components/MapEditorPanels";
import { flipGeometry, nudgeGeometry, rotateGeometry, scaleGeometry, type Point } from "../lib/geometryTransforms";
import { expandToGroups, selectionCenter, zOrderUpdates } from "../lib/structureGroups";
import { clampStampScale, defaultBlocksForKind, normalizeDegrees, stampGeometry, structureLabel, structureTypes, wallBlocks, type StructureBlocks } from "../lib/structures";
import { useStructureEditor, type NewStructure, type StructureFields } from "../lib/useStructureEditor";

const invalidGeometry = "Geometry must be valid JSON: an array of points with x and y coordinates.";

export function MapEditorPage() {
  const { mapId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const editor = useStructureEditor(mapId);
  const { map, structures, selectedIds, busy, error, notice, setError, setNotice, select, update, create, remove } = editor;
  const [tool, setTool] = useState<EditorTool>("select");
  const [brushKind, setBrushKind] = useState("wall");
  const [brushBlocks, setBrushBlocks] = useState<StructureBlocks>(wallBlocks);
  const [stampRotation, setStampRotation] = useState(0);
  const [stampScale, setStampScale] = useState(100);
  const [jsonText, setJsonText] = useState('[{"x":4,"y":4},{"x":10,"y":4}]');
  const [asset, setAsset] = useState<File | null>(null);
  const [confirmingMapDelete, setConfirmingMapDelete] = useState(false);
  const clipboard = useRef<MapStructure[]>([]);
  const pasteCount = useRef(0);

  const grid = Number(map?.grid_size_m || 1);
  const selected = structures.filter((structure) => selectedIds.includes(structure.id));
  const groupIds = new Set(selected.map((structure) => structure.group_id ?? null));
  const groupDisabled = selected.length < 2 || (groupIds.size === 1 && !groupIds.has(null));
  const ungroupDisabled = !selected.some((structure) => structure.group_id);
  const mapJSON = map ? JSON.stringify({ ...map, structures }, null, 2) : "";
  const isOwner = session.status === "authenticated" && map?.owner_id === session.user.id;

  function selectKind(kind: string) {
    setBrushKind(kind);
    setBrushBlocks(defaultBlocksForKind(kind));
  }

  function pickBrush(kind: string) {
    selectKind(kind);
    setTool("place");
  }

  function place(point: Point) {
    void create([{
      kind: brushKind,
      geometry: stampGeometry(brushKind, point, grid, stampRotation, stampScale),
      ...brushBlocks,
      cover_bonus: 0,
      pass_rules: {},
    }]);
  }

  const transformSelection = (transform: (geometry: Point[], center: Point) => Point[]) => {
    if (selected.length === 0) return;
    const center = selectionCenter(selected);
    void update(selected.map((structure) => ({ id: structure.id, fields: { geometry: transform(structure.geometry, center) } })));
  };
  const rotateSelection = (degrees: number) => {
    if (normalizeDegrees(degrees) !== 0) transformSelection((geometry, center) => rotateGeometry(geometry, degrees, center));
  };
  const scaleSelection = (factor: number) => {
    if (factor > 0 && factor !== 1) transformSelection((geometry, center) => scaleGeometry(geometry, factor, center));
  };
  const flipSelection = (axis: "horizontal" | "vertical") => transformSelection((geometry, center) => flipGeometry(geometry, axis, center));
  const nudgeSelection = (dx: number, dy: number) => transformSelection((geometry) => nudgeGeometry(geometry, dx, dy));

  function setSelectionFields(fields: StructureFields) {
    if (selected.length === 0) return;
    void update(selected.map((structure) => ({ id: structure.id, fields })));
  }

  function reorderSelection(direction: "front" | "back") {
    if (selected.length === 0) return;
    void update(zOrderUpdates(selectedIds, structures, direction).map((change) => ({ id: change.id, fields: { z_index: change.z_index } })));
  }

  function groupSelection() {
    if (groupDisabled) return;
    const groupId = crypto.randomUUID();
    void update(selected.map((structure) => ({ id: structure.id, fields: { group_id: groupId } })), `Grouped ${selected.length} structures.`);
  }

  function ungroupSelection() {
    if (ungroupDisabled) return;
    const grouped = selected.filter((structure) => structure.group_id);
    void update(grouped.map((structure) => ({ id: structure.id, fields: { group_id: null } })), `Ungrouped ${grouped.length} structures.`);
  }

  function copySelection() {
    if (selected.length === 0) return;
    clipboard.current = selected;
    pasteCount.current = 0;
    setError("");
    setNotice(`Copied ${selected.length} structures.`);
  }

  /** Creates offset copies on top of everything, with fresh groups, and selects them. Returns how many were created. */
  async function createCopies(sources: MapStructure[], offset: number, message: string) {
    if (sources.length === 0) return 0;
    const groups = new Map<string, string>();
    const top = Math.max(0, ...structures.map((structure) => structure.z_index ?? 0));
    const payloads: NewStructure[] = sources.map((source, index) => {
      let groupId: string | undefined;
      if (source.group_id) {
        groupId = groups.get(source.group_id) ?? crypto.randomUUID();
        groups.set(source.group_id, groupId);
      }
      return {
        kind: source.kind,
        geometry: nudgeGeometry(source.geometry, offset, offset),
        blocks_vision: source.blocks_vision,
        blocks_movement: source.blocks_movement,
        blocks_attacks: source.blocks_attacks,
        cover_bonus: source.cover_bonus,
        pass_rules: source.pass_rules,
        z_index: top + index + 1,
        ...(groupId ? { group_id: groupId } : {}),
      };
    });
    const created = await create(payloads, message);
    if (created.length > 0) select(created.map((structure) => structure.id));
    return created.length;
  }

  async function pasteClipboard() {
    const sources = clipboard.current;
    if (sources.length === 0) return;
    // Each paste lands one grid square further; a paste dropped while saving does not advance the offset.
    const created = await createCopies(sources, grid * (pasteCount.current + 1), `Pasted ${sources.length} structures.`);
    if (created > 0) pasteCount.current += 1;
  }

  function duplicateSelection() {
    void createCopies(selected, grid, `Duplicated ${selected.length} structures.`);
  }

  const commands: SelectionCommands = {
    setFields: setSelectionFields,
    rotate: rotateSelection,
    scale: scaleSelection,
    flip: flipSelection,
    duplicate: duplicateSelection,
    group: groupSelection,
    ungroup: ungroupSelection,
    front: () => reorderSelection("front"),
    back: () => reorderSelection("back"),
    remove: () => void remove(selectedIds),
  };

  const contextActions: EditorAction[] = [
    { id: "duplicate", label: "Duplicate", shortcut: "Ctrl+D" },
    { id: "copy", label: "Copy", shortcut: "Ctrl+C" },
    { id: "front", label: "Bring to front" },
    { id: "back", label: "Send to back" },
    { id: "group", label: "Group", shortcut: "Ctrl+G", disabled: groupDisabled },
    { id: "ungroup", label: "Ungroup", shortcut: "Ctrl+Shift+G", disabled: ungroupDisabled },
    { id: "delete", label: "Delete", shortcut: "Del", danger: true },
  ];
  const contextAction: Record<string, () => void> = {
    duplicate: duplicateSelection,
    copy: copySelection,
    front: commands.front,
    back: commands.back,
    group: groupSelection,
    ungroup: ungroupSelection,
    delete: commands.remove,
  };

  /** Returns true when the key ran an editor shortcut; anything else keeps the browser's default. */
  function handleShortcut(event: KeyboardEvent): boolean {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const mod = event.ctrlKey || event.metaKey;
    const hasSelection = selected.length > 0;
    if (mod) {
      if (key === "z" && !event.shiftKey) void editor.undo();
      else if ((key === "z" && event.shiftKey) || key === "y") void editor.redo();
      // Copying highlighted page text (e.g. the exported JSON) keeps working.
      else if (key === "c" && hasSelection && !window.getSelection()?.toString()) copySelection();
      else if (key === "v" && clipboard.current.length > 0) void pasteClipboard();
      else if (key === "d" && hasSelection) duplicateSelection();
      else if (key === "a" && structures.length > 0) select(structures.map((structure) => structure.id));
      else if (key === "g" && event.shiftKey && !ungroupDisabled) ungroupSelection();
      else if (key === "g" && !event.shiftKey && !groupDisabled) groupSelection();
      else return false;
      return true;
    }
    if (key === "v") setTool("select");
    else if (key === "b") setTool("place");
    else if (key === "Escape") {
      if (tool === "place") setTool("select");
      else if (selectedIds.length > 0) select([]);
      else return false;
    } else if (key === "Delete" || key === "Backspace") {
      if (!hasSelection) return false;
      void remove(selectedIds);
    } else if (key.startsWith("Arrow")) {
      if (!hasSelection) return false;
      const step = event.shiftKey ? grid : 0.1;
      const [dx, dy] = key === "ArrowLeft" ? [-step, 0] : key === "ArrowRight" ? [step, 0] : key === "ArrowUp" ? [0, -step] : [0, step];
      nudgeSelection(dx, dy);
    } else if (key === "q" || key === "e") {
      const degrees = key === "q" ? -15 : 15;
      if (tool === "place") setStampRotation((current) => normalizeDegrees(current + degrees));
      else rotateSelection(degrees);
    } else if (key === "[" || key === "]") {
      if (tool === "place") setStampScale((current) => clampStampScale(current + (key === "[" ? -10 : 10)));
      else scaleSelection(key === "[" ? 0.9 : 1.1);
    } else return false;
    return true;
  }

  const shortcutRef = useRef(handleShortcut);
  shortcutRef.current = handleShortcut;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      if (shortcutRef.current(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function toggleLayer(id: string, additive: boolean) {
    if (!additive) {
      select([id]);
      return;
    }
    if (!selectedIds.includes(id)) {
      select([...selectedIds, id]);
      return;
    }
    const group = new Set(expandToGroups([id], structures));
    select(selectedIds.filter((selectedId) => !group.has(selectedId)));
  }

  async function addFromJSON(event: FormEvent) {
    event.preventDefault();
    const points = parsePoints(jsonText);
    if (!points) {
      setError(invalidGeometry);
      return;
    }
    const created = await create([{ kind: brushKind, geometry: points, ...brushBlocks, cover_bonus: 0, pass_rules: {} }], "Structure added.");
    if (created.length === 0) return;
    select(created.map((structure) => structure.id));
    setTool("select");
  }

  function upload() {
    if (!asset) return;
    void editor.runSaving(async () => {
      const form = new FormData();
      form.append("file", asset);
      form.append("name", asset.name);
      form.append("kind", "map_background");
      const result = await apiFetch<{ id: string }>("/api/assets", { method: "POST", body: form });
      await patchJSON(`/api/maps/${mapId}`, { background_asset_id: result.id });
    }, "Background uploaded and attached to this map.");
  }

  async function deleteMap() {
    editor.setBusy(true);
    setError("");
    setNotice("");
    try {
      await deleteJSON(`/api/maps/${mapId}`);
      navigate("/maps");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the map.");
      setConfirmingMapDelete(false);
      editor.setBusy(false);
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

  function importGeometryFromFile(file: File | null | undefined) {
    if (!file) return;
    setError("");
    setNotice("");
    const reader = new FileReader();
    reader.onload = () => {
      const geometry = parsePoints(String(reader.result ?? ""));
      if (!geometry) {
        setError("Imported geometry must be JSON: an array of points with x and y coordinates.");
        return;
      }
      setJsonText(JSON.stringify(geometry));
      setNotice("Geometry loaded from JSON. Press Add structure to save it.");
    };
    reader.readAsText(file);
  }

  if (editor.loading) return <div className="card" role="status">Opening map editor…</div>;
  if (!map) return <div className="card space-y-4"><p role="alert" className="text-[var(--pink)]">Could not open this map: {error}</p><Link className="btn-secondary" to="/maps">Back to maps</Link></div>;

  const saveMap = (fields: Record<string, unknown>, message: string) => void editor.runSaving(() => patchJSON(`/api/maps/${mapId}`, fields), message);

  return <div className="map-studio workspace-page">
    <header className="map-studio-hero">
      <div>
        <Link className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--paper)]" to="/maps"><ArrowLeft size={16} aria-hidden="true" />All maps</Link>
        <p className="eyebrow">Cartographer studio</p>
        <h1 className="page-heading break-words">{map.name}</h1>
        <p className="page-description">Stamp structures with the Place tool (B), then arrange them with the Select tool (V): move, resize, rotate, group and layer them on the canvas or from the selection panel. Copy, paste, duplicate, undo and redo use the usual shortcuts.</p>
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
          <p className="text-muted mt-2 text-sm">Place tool (B): pick a brush and click the map; Q/E rotate the stamp and [ ] resize it. Select tool (V): click or drag across structures, then drag to move, drag a corner to resize, or drag the round handle to rotate. Right-click a structure for actions. Ctrl/Cmd+C, V, D copy, paste and duplicate; Ctrl/Cmd+G groups and Ctrl/Cmd+Shift+G ungroups; arrow keys nudge (Shift for a full grid square); Delete removes; Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. Scroll to zoom and drag with the right or middle button (or hold Space) to pan.</p>
        </div>
        <div className="map-studio-tool-chips" aria-label="Active editor state">
          <span>{tool === "place" ? `Tool: Place · ${structureLabel(brushKind)}` : "Tool: Select"}</span>
          <span>{selectedIds.length} selected</span>
        </div>
      </div>
      <MapEditorCanvas
        map={map}
        structures={structures}
        selectedStructureIds={selectedIds}
        tool={tool}
        stamp={{ kind: brushKind, rotationDeg: stampRotation, scalePercent: stampScale }}
        contextActions={contextActions}
        controls={<EditorToolbar tool={tool} busy={busy} canUndo={editor.canUndo} canRedo={editor.canRedo} onTool={setTool} onUndo={() => void editor.undo()} onRedo={() => void editor.redo()} />}
        selector={<div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
          {tool === "place"
            ? <PlacePanel kind={brushKind} rotation={stampRotation} scale={stampScale} blocks={brushBlocks} busy={busy} onKind={pickBrush} onRotation={setStampRotation} onScale={setStampScale} onBlocks={setBrushBlocks} />
            : <SelectionPanel selected={selected} busy={busy} groupDisabled={groupDisabled} ungroupDisabled={ungroupDisabled} commands={commands} />}
          <LayersList structures={structures} selectedIds={selectedIds} onSelect={toggleLayer} />
        </div>}
        disabled={busy}
        onSelectStructures={select}
        onTransformStructures={(changes) => void update(changes.map((change) => ({ id: change.id, fields: { geometry: change.geometry } })))}
        onPlace={place}
        onContextAction={(id) => contextAction[id]?.()}
      />
    </section>

    <div className="map-studio-dock">
      <section className="card min-w-0 space-y-5">
        <h2 className="text-2xl">Map settings</h2>
        <p className="text-muted text-sm">Name, dimensions, and grid changes save when you leave a field.</p>
        <label className="field-label block" htmlFor="map-name">Map name</label>
        <input id="map-name" className="w-full" defaultValue={map.name} disabled={busy} onBlur={(e) => { if (e.target.value !== map.name) saveMap({ name: e.target.value }, "Map name saved."); }} />
        <div className="grid grid-cols-2 gap-3">
          <label className="field-label" htmlFor="map-width">
            Width (meters)
            <input id="map-width" className="w-full" type="number" min="0.1" step="any" defaultValue={Number(map.width_m)} disabled={busy} onBlur={(e) => { const value = Number(e.target.value); if (value !== Number(map.width_m) && e.target.validity.valid && value > 0) saveMap({ width_m: value }, "Map width saved."); }} />
          </label>
          <label className="field-label" htmlFor="map-height">
            Height (meters)
            <input id="map-height" className="w-full" type="number" min="0.1" step="any" defaultValue={Number(map.height_m)} disabled={busy} onBlur={(e) => { const value = Number(e.target.value); if (value !== Number(map.height_m) && e.target.validity.valid && value > 0) saveMap({ height_m: value }, "Map height saved."); }} />
          </label>
        </div>
        <label className="field-label block" htmlFor="map-grid">Grid size (meters)</label>
        <input id="map-grid" className="w-full" type="number" min="0.1" step="any" defaultValue={Number(map.grid_size_m)} disabled={busy} onBlur={(e) => { const value = Number(e.target.value); if (value !== Number(map.grid_size_m) && e.target.validity.valid && value > 0) saveMap({ grid_size_m: value }, "Grid size saved."); }} />
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

      <form className="card space-y-5" onSubmit={(event) => void addFromJSON(event)} aria-labelledby="add-from-json-heading">
        <h2 id="add-from-json-heading" className="text-2xl">Add from JSON</h2>
        <label className="field-label block" htmlFor="structure-kind">Structure type</label>
        <select id="structure-kind" className="w-full" value={brushKind} onChange={(e) => selectKind(e.target.value)}>{structureTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
        <label className="field-label block" htmlFor="structure-geometry">Geometry (JSON)</label>
        <textarea id="structure-geometry" className="min-h-40 w-full font-mono text-sm" spellCheck={false} value={jsonText} onChange={(e) => setJsonText(e.target.value)} aria-describedby="geometry-help" />
        <p id="geometry-help" className="text-muted text-xs">An array of x/y points in meters. Adding saves the structure straight away.</p>
        <label className="field-label block" htmlFor="geometry-import">Import geometry JSON</label>
        <input id="geometry-import" type="file" accept="application/json,.json" className="w-full max-w-full text-sm" onChange={(e) => importGeometryFromFile(e.target.files?.[0])} />
        <fieldset className="space-y-3">
          <legend className="field-label mb-3">This structure blocks</legend>
          {(["blocks_vision", "blocks_movement", "blocks_attacks"] as const).map((key) => <label className="flex items-center gap-3 text-sm" key={key}><input type="checkbox" checked={brushBlocks[key]} onChange={(e) => setBrushBlocks({ ...brushBlocks, [key]: e.target.checked })} />{key === "blocks_vision" ? "Line of sight" : key === "blocks_movement" ? "Movement" : "Attacks"}</label>)}
        </fieldset>
        <button className="btn w-full" disabled={busy}><Plus size={18} aria-hidden="true" />{busy ? "Saving…" : "Add structure"}</button>
      </form>

      <section className="card min-w-0 space-y-5">
        <h2 className="text-2xl">Map JSON</h2>
        <p className="text-muted text-sm">Export the whole saved map, structures included.</p>
        <button className="btn-secondary w-full" type="button" onClick={exportMapJSON}>Export map JSON</button>
        <pre className="max-h-64 rounded-lg border border-[var(--paper)]/10 bg-[var(--input)] p-3 text-xs text-[var(--paper)]">{mapJSON}</pre>
      </section>
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

function safeFileName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "map";
}
