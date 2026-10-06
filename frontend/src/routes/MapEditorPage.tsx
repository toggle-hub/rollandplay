import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle, CircleNotch, Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { apiFetch, deleteJSON } from "../api/client";
import { useSession } from "../auth/SessionContext";
import type { MapStructure } from "../api/types";
import type { EditorAction } from "../components/EditorContextMenu";
import { EditorShortcutSheet } from "../components/EditorShortcutSheet";
import { MapEditorCanvas, type EditorTool } from "../components/MapEditorCanvas";
import { EditorToolbar, LayersList, PlacePanel, SelectionPanel, type SelectionCommands } from "../components/MapEditorPanels";
import { MapSettingsPanel } from "../components/MapSettingsPanel";
import { useToast } from "../components/Toast";
import { UseMapInRoom } from "../components/UseMapInRoom";
import { flipGeometry, nudgeGeometry, rotateGeometry, scaleGeometry, type Point } from "../lib/geometryTransforms";
import { shortcutLabel } from "../lib/platform";
import { expandToGroups, selectionCenter, zOrderUpdates } from "../lib/structureGroups";
import { clampStampScale, defaultBlocksForKind, normalizeDegrees, stampGeometry, structureLabel, structureTypes, wallBlocks, type StructureBlocks } from "../lib/structures";
import { useLayerFlags } from "../lib/useLayerFlags";
import { useStructureEditor, type NewStructure, type StructureFields } from "../lib/useStructureEditor";

const invalidGeometry = "Geometry must be valid JSON: an array of points with x and y coordinates.";
/** How long a status-bar message stays. */
const noticeMs = 4000;
const fineNudge = 0.1;

export function MapEditorPage() {
  const { mapId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const toast = useToast();
  const reportError = useCallback((message: string) => toast({ kind: "error", message }), [toast]);
  const editor = useStructureEditor(mapId, reportError);
  const { map, structures, selectedIds, notice, setNotice, update, create, remove } = editor;
  const layers = useLayerFlags(mapId);
  const [tool, setTool] = useState<EditorTool>("select");
  const [brushKind, setBrushKind] = useState("wall");
  const [brushBlocks, setBrushBlocks] = useState<StructureBlocks>(wallBlocks);
  const [stampRotation, setStampRotation] = useState(0);
  const [stampScale, setStampScale] = useState(100);
  const [jsonText, setJsonText] = useState('[{"x":4,"y":4},{"x":10,"y":4}]');
  const [confirmingMapDelete, setConfirmingMapDelete] = useState(false);
  const [deletingMap, setDeletingMap] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [hoveredLayer, setHoveredLayer] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [visibleNotice, setVisibleNotice] = useState("");
  const clipboard = useRef<MapStructure[]>([]);
  const pasteCount = useRef(0);

  useEffect(() => {
    setVisibleNotice(notice?.text ?? "");
    if (!notice) return;
    const timer = window.setTimeout(() => setVisibleNotice(""), noticeMs);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const grid = Number(map?.grid_size_m || 1);
  const selected = structures.filter((structure) => selectedIds.includes(structure.id));
  const groupIds = new Set(selected.map((structure) => structure.group_id ?? null));
  const groupDisabled = selected.length < 2 || (groupIds.size === 1 && !groupIds.has(null));
  const ungroupDisabled = !selected.some((structure) => structure.group_id);
  const mapJSON = map ? JSON.stringify({ ...map, structures }, null, 2) : "";
  const isOwner = session.status === "authenticated" && map?.owner_id === session.user.id;
  const selectable = (id: string) => !layers.locked.has(id) && !layers.hidden.has(id);
  const select = (ids: string[]) => editor.select(ids, selectable);

  function selectKind(kind: string) {
    setBrushKind(kind);
    setBrushBlocks(defaultBlocksForKind(kind));
  }

  function pickBrush(kind: string) {
    selectKind(kind);
    if (tool === "select") setTool("place");
  }

  const newStructure = (geometry: Point[]): NewStructure => ({ kind: brushKind, geometry, ...brushBlocks, cover_bonus: 0, pass_rules: {} });

  function place(point: Point) {
    create([newStructure(stampGeometry(brushKind, point, grid, stampRotation, stampScale))]);
  }

  function drawShape(geometry: Point[]) {
    create([newStructure(geometry)], `${structureLabel(brushKind)} drawn.`);
  }

  const transformSelection = (transform: (geometry: Point[], center: Point) => Point[]) => {
    if (selected.length === 0) return;
    const center = selectionCenter(selected);
    update(selected.map((structure) => ({ id: structure.id, fields: { geometry: transform(structure.geometry, center) } })));
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
    update(selected.map((structure) => ({ id: structure.id, fields })));
  }

  function reorderSelection(direction: "front" | "back") {
    if (selected.length === 0) return;
    update(zOrderUpdates(selectedIds, structures, direction).map((change) => ({ id: change.id, fields: { z_index: change.z_index } })));
  }

  function groupSelection() {
    if (groupDisabled) return;
    const groupId = crypto.randomUUID();
    update(selected.map((structure) => ({ id: structure.id, fields: { group_id: groupId } })), `Grouped ${selected.length} structures.`);
  }

  function ungroupSelection() {
    if (ungroupDisabled) return;
    const grouped = selected.filter((structure) => structure.group_id);
    update(grouped.map((structure) => ({ id: structure.id, fields: { group_id: null } })), `Ungrouped ${grouped.length} structures.`);
  }

  function copySelection() {
    if (selected.length === 0) return;
    clipboard.current = selected;
    pasteCount.current = 0;
    setNotice(`Copied ${selected.length} structures.`);
  }

  /** Creates offset copies on top of everything, with fresh groups, and selects them. */
  function createCopies(sources: MapStructure[], offset: number, message: string) {
    if (sources.length === 0) return;
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
    const created = create(payloads, message);
    if (created.length > 0) select(created.map((structure) => structure.id));
  }

  function pasteClipboard() {
    const sources = clipboard.current;
    if (sources.length === 0) return;
    // Each paste lands one grid square further.
    pasteCount.current += 1;
    createCopies(sources, grid * pasteCount.current, `Pasted ${sources.length} structures.`);
  }

  function duplicateSelection() {
    createCopies(selected, grid, `Duplicated ${selected.length} structures.`);
  }

  const selectAll = () => select(structures.map((structure) => structure.id));

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
    remove: () => remove(selectedIds),
  };

  const contextActions: EditorAction[] = [
    { id: "duplicate", label: "Duplicate", shortcut: shortcutLabel("mod+d") },
    { id: "copy", label: "Copy", shortcut: shortcutLabel("mod+c") },
    { id: "paste", label: "Paste", shortcut: shortcutLabel("mod+v"), disabled: clipboard.current.length === 0 },
    { id: "front", label: "Bring to front" },
    { id: "back", label: "Send to back" },
    { id: "group", label: "Group", shortcut: shortcutLabel("mod+g"), disabled: groupDisabled },
    { id: "ungroup", label: "Ungroup", shortcut: shortcutLabel("mod+shift+g"), disabled: ungroupDisabled },
    { id: "delete", label: "Delete", shortcut: shortcutLabel("del"), danger: true },
  ];
  const mapContextActions: EditorAction[] = [
    { id: "paste", label: "Paste", shortcut: shortcutLabel("mod+v"), disabled: clipboard.current.length === 0 },
    { id: "select-all", label: "Select all", shortcut: shortcutLabel("mod+a"), disabled: structures.length === 0 },
  ];
  const contextAction: Record<string, () => void> = {
    duplicate: duplicateSelection,
    copy: copySelection,
    paste: pasteClipboard,
    "select-all": selectAll,
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
      if (key === "z" && !event.shiftKey) editor.undo();
      else if ((key === "z" && event.shiftKey) || key === "y") editor.redo();
      // Copying highlighted page text (e.g. the exported JSON) keeps working.
      else if (key === "c" && hasSelection && !window.getSelection()?.toString()) copySelection();
      else if (key === "v" && clipboard.current.length > 0) pasteClipboard();
      else if (key === "d" && hasSelection) duplicateSelection();
      else if (key === "a" && structures.length > 0) selectAll();
      else if (key === "g" && event.shiftKey && !ungroupDisabled) ungroupSelection();
      else if (key === "g" && !event.shiftKey && !groupDisabled) groupSelection();
      else return false;
      return true;
    }
    if (key === "?") setShowShortcuts((current) => !current);
    else if (key === "v") setTool("select");
    else if (key === "b") setTool("place");
    else if (key === "d") setTool("draw");
    else if (key === "Escape") {
      if (tool !== "select") setTool("select");
      else if (selectedIds.length > 0) select([]);
      else return false;
    } else if (key === "Delete" || key === "Backspace") {
      if (!hasSelection) return false;
      remove(selectedIds);
    } else if (key.startsWith("Arrow")) {
      if (!hasSelection) return false;
      const step = event.shiftKey ? fineNudge : grid;
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

  function toggleLayerFlag(flag: "locked" | "hidden", id: string) {
    const turningOn = !layers[flag].has(id);
    layers.toggle(flag, id);
    // Locked and hidden pieces leave the selection.
    if (turningOn && selectedIds.includes(id)) editor.select(selectedIds.filter((selectedId) => selectedId !== id));
    if (flag === "hidden" && turningOn && hoveredLayer === id) setHoveredLayer(null);
  }

  function addFromJSON(event: FormEvent) {
    event.preventDefault();
    const points = parsePoints(jsonText);
    if (!points) {
      reportError(invalidGeometry);
      return;
    }
    const created = create([newStructure(points)], "Structure added.");
    select(created.map((structure) => structure.id));
    setTool("select");
  }

  async function uploadBackground(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);
      form.append("kind", "map_background");
      const result = await apiFetch<{ id: string }>("/api/assets", { method: "POST", body: form });
      editor.updateMap({ background_asset_id: result.id }, "Background added.");
    } catch (err) {
      reportError(err instanceof Error ? `Could not upload the background: ${err.message}` : "Could not upload the background.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteMap() {
    setDeletingMap(true);
    try {
      await editor.flush();
      await deleteJSON(`/api/maps/${mapId}`);
      navigate("/maps");
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Could not delete the map.");
      setConfirmingMapDelete(false);
      setDeletingMap(false);
    }
  }

  function exportMapJSON() {
    if (!map) return;
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
    const reader = new FileReader();
    reader.onload = () => {
      const geometry = parsePoints(String(reader.result ?? ""));
      if (!geometry) {
        reportError("Imported geometry must be JSON: an array of points with x and y coordinates.");
        return;
      }
      setJsonText(JSON.stringify(geometry));
      setNotice("Geometry loaded from JSON. Press Add structure to save it.");
    };
    reader.readAsText(file);
  }

  if (editor.loading) return <div className="card" role="status">Opening map editor…</div>;
  if (!map) return <div className="card space-y-4"><p role="alert" className="text-[var(--pink)]">Could not open this map: {editor.loadError}</p><Link className="btn-secondary" to="/maps">Back to maps</Link></div>;

  const saveIndicator = editor.saveState === "saving"
    ? <span className="flex items-center gap-1.5 text-[var(--lavender)]"><CircleNotch size={14} className="animate-spin" aria-hidden="true" />Saving…</span>
    : editor.saveState === "failed"
      ? <span className="flex items-center gap-1.5 text-[var(--pink)]"><WarningCircle size={14} weight="fill" aria-hidden="true" />Some changes weren’t saved</span>
      : editor.saveState === "saved"
        ? <span className="flex items-center gap-1.5 text-[var(--green)]"><CheckCircle size={14} weight="fill" aria-hidden="true" />Saved</span>
        : null;

  return <div className="map-studio workspace-page">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <Link className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--paper)]" to="/maps"><ArrowLeft size={16} aria-hidden="true" />All maps</Link>
        <h1 className="page-heading break-words">{map.name}</h1>
        <p className="text-muted text-sm" aria-label="Map summary">{map.width_m} × {map.height_m} m · {map.grid_size_m} m grid · {structures.length} layers</p>
      </div>
      <UseMapInRoom mapId={map.id} beforeLeave={editor.flush} onError={reportError} />
    </header>

    <section className="map-studio-canvas-card card min-w-0" aria-label="Map canvas">
      <div className="map-studio-tool-chips mb-3" aria-label="Active editor state">
        <span>{tool === "place" ? `Tool: Place · ${structureLabel(brushKind)}` : tool === "draw" ? `Tool: Draw · ${structureLabel(brushKind)}` : "Tool: Select"}</span>
        <span>{selectedIds.length} selected</span>
      </div>
      <MapEditorCanvas
        map={map}
        structures={structures}
        selectedStructureIds={selectedIds}
        tool={tool}
        stamp={{ kind: brushKind, rotationDeg: stampRotation, scalePercent: stampScale }}
        contextActions={contextActions}
        mapContextActions={mapContextActions}
        hiddenIds={layers.hidden}
        lockedIds={layers.locked}
        highlightId={hoveredLayer}
        controls={<EditorToolbar tool={tool} canUndo={editor.canUndo} canRedo={editor.canRedo} onTool={setTool} onUndo={editor.undo} onRedo={editor.redo} />}
        selector={<div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
          {tool === "select"
            ? <SelectionPanel selected={selected} groupDisabled={groupDisabled} ungroupDisabled={ungroupDisabled} commands={commands} />
            : <PlacePanel tool={tool} kind={brushKind} rotation={stampRotation} scale={stampScale} blocks={brushBlocks} onKind={pickBrush} onRotation={setStampRotation} onScale={setStampScale} onBlocks={setBrushBlocks} />}
          <LayersList structures={structures} selectedIds={selectedIds} lockedIds={layers.locked} hiddenIds={layers.hidden} onSelect={toggleLayer} onHover={setHoveredLayer} onToggle={toggleLayerFlag} />
        </div>}
        status={<>
          {visibleNotice && <span className="hidden max-w-[260px] truncate text-[var(--paper)] lg:inline" data-testid="map-editor-notice">{visibleNotice}</span>}
          {saveIndicator}
          <button type="button" className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--paper)]/25 text-xs font-semibold text-[var(--paper)] hover:border-[var(--accent)]" aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)" onClick={() => setShowShortcuts(true)}>?</button>
        </>}
        onSelectStructures={select}
        onTransformStructures={(changes) => update(changes.map((change) => ({ id: change.id, fields: { geometry: change.geometry } })))}
        onPlace={place}
        onDrawShape={drawShape}
        onContextAction={(id) => contextAction[id]?.()}
      />
    </section>
    {showShortcuts && <EditorShortcutSheet onClose={() => setShowShortcuts(false)} />}

    <div className="grid items-start gap-6 lg:grid-cols-2">
      <MapSettingsPanel map={map} uploading={uploading} onSave={editor.updateMap} onUpload={(file) => void uploadBackground(file)}>
        {isOwner && <div className="border-t border-[var(--paper)]/10 pt-5">
          <h3 className="field-label mb-3">Delete map</h3>
          <p className="text-muted text-xs">Removes this map and every structure on it. A map attached to a room can’t be deleted.</p>
          {confirmingMapDelete ? <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="mr-auto text-sm text-[var(--pink)]">Delete “{map.name}” permanently?</span>
            <button className="btn-secondary text-[var(--pink)]" type="button" disabled={deletingMap} onClick={() => void deleteMap()}>{deletingMap ? "Deleting…" : "Confirm"}</button>
            <button className="btn-secondary" type="button" disabled={deletingMap} onClick={() => setConfirmingMapDelete(false)}>Cancel</button>
          </div> : <button className="btn-secondary mt-4" type="button" onClick={() => setConfirmingMapDelete(true)}><Trash size={18} aria-hidden="true" />Delete map</button>}
        </div>}
      </MapSettingsPanel>

      <details className="card min-w-0">
        <summary className="cursor-pointer text-lg">Advanced: import/export</summary>
        <div className="mt-5 grid gap-8">
          <form className="space-y-5" onSubmit={addFromJSON} aria-labelledby="add-from-json-heading">
            <h2 id="add-from-json-heading" className="text-xl">Add from JSON</h2>
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
            <button className="btn w-full"><Plus size={18} aria-hidden="true" />Add structure</button>
          </form>
          <section className="min-w-0 space-y-5">
            <h2 className="text-xl">Map JSON</h2>
            <p className="text-muted text-sm">Export the whole saved map, structures included.</p>
            <button className="btn-secondary w-full" type="button" onClick={exportMapJSON}>Export map JSON</button>
            <pre className="max-h-64 rounded-lg border border-[var(--paper)]/10 bg-[var(--input)] p-3 text-xs text-[var(--paper)]">{mapJSON}</pre>
          </section>
        </div>
      </details>
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
