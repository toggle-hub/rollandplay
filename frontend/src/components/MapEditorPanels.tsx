import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowClockwise, ArrowCounterClockwise, ArrowsIn, ArrowsOut, Cursor, Eye, EyeSlash, FlipHorizontal, FlipVertical, LockSimple, LockSimpleOpen, PencilSimpleLine, Stamp, Trash } from "@phosphor-icons/react";
import type { MapStructure } from "../api/types";
import { geometryBounds } from "../lib/geometryTransforms";
import { shortcutLabel } from "../lib/platform";
import { isAreaKind } from "../lib/structureStyle";
import { clampStampScale, normalizeDegrees, structureLabel, structureTypes, type StructureBlocks } from "../lib/structures";
import type { EditorTool } from "./MapEditorCanvas";

const blockKeys = ["blocks_vision", "blocks_movement", "blocks_attacks"] as const;
type BlockKey = (typeof blockKeys)[number];
const blockLabel = (key: BlockKey) => key === "blocks_vision" ? "Line of sight" : key === "blocks_movement" ? "Movement" : "Attacks";

const sectionHeading = "text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]";
const railButton = "btn-secondary flex h-9 min-h-0 w-full items-center justify-center gap-1 px-1 py-1.5 text-[10px] [&>svg]:shrink-0";
const panelButton = "btn-secondary flex h-8 min-h-0 w-full items-center justify-center gap-1 px-1.5 py-1 text-[11px] [&>svg]:shrink-0";

export function EditorToolbar({ tool, canUndo, canRedo, onTool, onUndo, onRedo }: {
  tool: EditorTool;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (tool: EditorTool) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const tools: { value: EditorTool; label: string; key: string; icon: ReactNode }[] = [
    { value: "select", label: "Select tool", key: "V", icon: <Cursor size={16} aria-hidden="true" /> },
    { value: "draw", label: "Draw tool", key: "D", icon: <PencilSimpleLine size={16} aria-hidden="true" /> },
    { value: "place", label: "Place tool", key: "B", icon: <Stamp size={16} aria-hidden="true" /> },
  ];
  const undo = `Undo (${shortcutLabel("mod+z")})`;
  const redo = `Redo (${shortcutLabel("mod+shift+z")})`;
  return <div className="grid gap-2" data-testid="map-structure-controls">
    <div className="grid gap-1 border-b border-[var(--paper)]/10 pb-2" role="group" aria-label="Tools">
      <span className={`px-1 ${sectionHeading}`}>Tools</span>
      <div className="grid grid-cols-3 gap-1">
        {tools.map((item) => <button
          key={item.value}
          className={`${railButton} ${tool === item.value ? "border-[var(--accent)]/90 bg-[var(--accent)]/15" : ""}`}
          type="button"
          aria-pressed={tool === item.value}
          aria-label={`${item.label} (${item.key})`}
          title={`${item.label} (${item.key})`}
          onClick={() => onTool(item.value)}
        >{item.icon}<span>{item.key}</span></button>)}
      </div>
    </div>
    <div className="grid gap-1" role="group" aria-label="History">
      <span className={`px-1 ${sectionHeading}`}>History</span>
      <div className="grid grid-cols-2 gap-1">
        <button className={railButton} type="button" disabled={!canUndo} aria-label={undo} title={undo} onClick={onUndo}><ArrowCounterClockwise size={16} aria-hidden="true" /></button>
        <button className={railButton} type="button" disabled={!canRedo} aria-label={redo} title={redo} onClick={onRedo}><ArrowClockwise size={16} aria-hidden="true" /></button>
      </div>
    </div>
  </div>;
}

/**
 * A number input that reports values inside [min, max] as they are typed and normalizes the text on blur.
 * While focused it keeps the typed text (e.g. "-" or "-1" on the way to "-15") instead of echoing the normalized value.
 */
function NumberField({ id, label, value, min, max, step, normalize, onChange }: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  normalize: (value: number) => number;
  onChange: (value: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);
  const inRange = (next: number) => Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max);
  return <label className="field-label grid gap-1 text-[11px]" htmlFor={id}>
    {label}
    <input
      ref={inputRef}
      id={id}
      className="w-full"
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = Number(event.target.value);
        if (event.target.value !== "" && inRange(next)) onChange(normalize(next));
      }}
      onBlur={() => {
        const next = Number(draft);
        if (draft === "" || !Number.isFinite(next)) setDraft(String(value));
        else {
          const normalized = normalize(next);
          setDraft(String(normalized));
          onChange(normalized);
        }
      }}
    />
  </label>;
}

function BlockCheckboxes({ legend, values, onChange }: {
  legend: string;
  values: Record<BlockKey, boolean | "mixed">;
  onChange: (key: BlockKey, checked: boolean) => void;
}) {
  return <fieldset className="grid gap-1.5">
    <legend className={`mb-1 ${sectionHeading}`}>{legend}</legend>
    {blockKeys.map((key) => <label className="flex items-center gap-2 text-xs text-[var(--paper)]" key={key}>
      <TriStateCheckbox checked={values[key]} onChange={(checked) => onChange(key, checked)} />
      {blockLabel(key)}
    </label>)}
  </fieldset>;
}

function TriStateCheckbox({ checked, onChange }: { checked: boolean | "mixed"; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checked === "mixed";
  }, [checked]);
  return <input ref={ref} type="checkbox" checked={checked === true} onChange={(event) => onChange(event.target.checked)} />;
}

/** Brush choices shared by the Place and Draw tools; stamp rotation and scale apply to Place only. */
export function PlacePanel({ tool, kind, rotation, scale, blocks, onKind, onRotation, onScale, onBlocks }: {
  tool: "place" | "draw";
  kind: string;
  rotation: number;
  scale: number;
  blocks: StructureBlocks;
  onKind: (kind: string) => void;
  onRotation: (degrees: number) => void;
  onScale: (percent: number) => void;
  onBlocks: (blocks: StructureBlocks) => void;
}) {
  return <div className="grid gap-3 border-b border-[var(--paper)]/10 px-3 py-3" data-testid="map-place-panel">
    <div>
      <h3 className={sectionHeading}>Brushes</h3>
      <p className="text-muted mt-1 text-[11px] leading-relaxed">{tool === "draw"
        ? isAreaKind(kind) ? "Click each corner of the area; Enter or double-click closes it." : "Click from corner to corner; Enter or double-click finishes, clicking the first point closes it."
        : "Click the map to stamp. Q/E rotate, [ ] resize."}</p>
    </div>
    <div className="grid gap-1.5" aria-label="Brush choices">
      {structureTypes.map((type) => {
        const selected = kind === type.value;
        return <button
          key={type.value}
          type="button"
          aria-pressed={selected}
          className={`rounded-lg border px-3 py-2 text-left transition-colors ${selected ? "border-[var(--accent)]/90 bg-[var(--accent)]/15" : "border-[var(--paper)]/10 bg-[var(--input)]/85 hover:border-[var(--muted)]/70"}`}
          onClick={() => onKind(type.value)}
        >
          <span className="flex items-center gap-2 text-sm text-[var(--paper)]"><span className={`h-2.5 w-2.5 rounded-full ${type.swatch}`} aria-hidden="true" />{type.label}</span>
          <span className="text-muted mt-0.5 block text-[11px]">{type.hint}</span>
        </button>;
      })}
    </div>
    {tool === "place" && <div className="grid grid-cols-2 gap-2">
      <NumberField id="stamp-rotation" label="Stamp rotation (°)" value={rotation} step={15} normalize={normalizeDegrees} onChange={onRotation} />
      <NumberField id="stamp-scale" label="Stamp scale (%)" value={scale} min={10} max={1000} step={10} normalize={clampStampScale} onChange={onScale} />
    </div>}
    <BlockCheckboxes legend="New structures block" values={blocks} onChange={(key, checked) => onBlocks({ ...blocks, [key]: checked })} />
  </div>;
}

export type SelectionCommands = {
  setFields: (fields: Partial<Pick<MapStructure, "kind" | BlockKey>>) => void;
  rotate: (degrees: number) => void;
  scale: (factor: number) => void;
  flip: (axis: "horizontal" | "vertical") => void;
  duplicate: () => void;
  group: () => void;
  ungroup: () => void;
  front: () => void;
  back: () => void;
  remove: () => void;
};

export function SelectionPanel({ selected, groupDisabled, ungroupDisabled, commands }: {
  selected: MapStructure[];
  groupDisabled: boolean;
  ungroupDisabled: boolean;
  commands: SelectionCommands;
}) {
  const [rotation, setRotation] = useState(90);
  const [scale, setScale] = useState(100);
  if (selected.length === 0) {
    return <div className="border-b border-[var(--paper)]/10 px-3 py-3" data-testid="map-selection-panel">
      <h3 className={sectionHeading}>Selection</h3>
      <p className="text-muted mt-1 text-[11px] leading-relaxed">Select a structure or drag across an area. Press D to draw walls or B to stamp pieces.</p>
    </div>;
  }
  const bounds = geometryBounds(selected.flatMap((structure) => structure.geometry));
  const kinds = new Set(selected.map((structure) => structure.kind));
  const kind = kinds.size === 1 ? selected[0].kind : "";
  const blockValue = (key: BlockKey) => selected.every((structure) => structure[key]) ? true : selected.some((structure) => structure[key]) ? "mixed" as const : false;
  const button = (label: string, onClick: () => void, options: { icon?: ReactNode; disabled?: boolean; ariaLabel?: string; danger?: boolean } = {}) =>
    <button className={`${panelButton} ${options.danger ? "text-[var(--pink)]" : ""}`} type="button" disabled={options.disabled} aria-label={options.ariaLabel} title={options.ariaLabel ?? label} onClick={onClick}>{options.icon}<span>{label}</span></button>;

  return <div className="grid gap-3 border-b border-[var(--paper)]/10 px-3 py-3" data-testid="map-selection-panel">
    <div>
      <h3 className={sectionHeading}>{selected.length} selected</h3>
      <p className="text-muted mt-0.5 text-[11px] tabular-nums">{bounds.width} × {bounds.height} m</p>
    </div>
    <label className="field-label grid gap-1 text-[11px]" htmlFor="selection-kind">
      Type
      <select id="selection-kind" className="w-full" value={kind} onChange={(event) => commands.setFields({ kind: event.target.value })}>
        {kind === "" && <option value="" disabled>Mixed</option>}
        {structureTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
      </select>
    </label>
    <BlockCheckboxes legend="Blocks" values={{ blocks_vision: blockValue("blocks_vision"), blocks_movement: blockValue("blocks_movement"), blocks_attacks: blockValue("blocks_attacks") }} onChange={(key, checked) => commands.setFields({ [key]: checked })} />
    <div className="grid gap-1.5">
      <label className="field-label grid gap-1 text-[11px]" htmlFor="selection-rotation">
        Rotate (°)
        <input id="selection-rotation" className="w-full" type="number" step={15} value={rotation} onChange={(event) => setRotation(Number(event.target.value))} />
      </label>
      {button("Apply rotation", () => commands.rotate(rotation), { disabled: !Number.isFinite(rotation) })}
      <div className="grid grid-cols-2 gap-1">
        {button("−15°", () => commands.rotate(-15), { ariaLabel: "Rotate −15°" })}
        {button("+15°", () => commands.rotate(15), { ariaLabel: "Rotate +15°" })}
      </div>
    </div>
    <div className="grid gap-1.5">
      <label className="field-label grid gap-1 text-[11px]" htmlFor="selection-scale">
        Scale (%)
        <input id="selection-scale" className="w-full" type="number" min={1} step={10} value={scale} onChange={(event) => setScale(Number(event.target.value))} />
      </label>
      {button("Apply scale", () => commands.scale(scale / 100), { disabled: !(scale > 0) })}
      <div className="grid grid-cols-2 gap-1">
        {button("10%", () => commands.scale(0.9), { icon: <ArrowsIn size={14} aria-hidden="true" />, ariaLabel: "Shrink 10%" })}
        {button("10%", () => commands.scale(1.1), { icon: <ArrowsOut size={14} aria-hidden="true" />, ariaLabel: "Grow 10%" })}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-1">
      {button("Flip H", () => commands.flip("horizontal"), { icon: <FlipHorizontal size={14} aria-hidden="true" />, ariaLabel: "Flip horizontal" })}
      {button("Flip V", () => commands.flip("vertical"), { icon: <FlipVertical size={14} aria-hidden="true" />, ariaLabel: "Flip vertical" })}
    </div>
    <div className="grid grid-cols-2 gap-1">
      {button("Duplicate", commands.duplicate)}
      {button("Group", commands.group, { disabled: groupDisabled })}
      {button("Ungroup", commands.ungroup, { disabled: ungroupDisabled })}
      {button("To front", commands.front, { ariaLabel: "Bring to front" })}
      {button("To back", commands.back, { ariaLabel: "Send to back" })}
      {button("Delete", commands.remove, { icon: <Trash size={14} aria-hidden="true" />, ariaLabel: "Delete selected structures", danger: true })}
    </div>
  </div>;
}

/** "Wall 3", counted per type in draw order, and the piece's size: its length, or width × height for areas. */
export function layerLabels(structures: MapStructure[]): Map<string, { name: string; size: string }> {
  const counts: Record<string, number> = {};
  const labels = new Map<string, { name: string; size: string }>();
  for (const structure of structures) {
    counts[structure.kind] = (counts[structure.kind] ?? 0) + 1;
    const geometry = structure.geometry;
    const closed = geometry.length > 2 && geometry[0].x === geometry[geometry.length - 1].x && geometry[0].y === geometry[geometry.length - 1].y;
    let size: string;
    if (closed || isAreaKind(structure.kind)) {
      const bounds = geometryBounds(geometry);
      size = `${bounds.width} × ${bounds.height} m`;
    } else {
      let length = 0;
      for (let index = 1; index < geometry.length; index += 1) length += Math.hypot(geometry[index].x - geometry[index - 1].x, geometry[index].y - geometry[index - 1].y);
      size = `${Math.round(length * 10) / 10} m`;
    }
    labels.set(structure.id, { name: `${structureLabel(structure.kind)} ${counts[structure.kind]}`, size });
  }
  return labels;
}

export function LayersList({ structures, selectedIds, lockedIds, hiddenIds, onSelect, onHover, onToggle }: {
  /** Structures in draw order; the list shows the topmost first. */
  structures: MapStructure[];
  selectedIds: string[];
  lockedIds: ReadonlySet<string>;
  hiddenIds: ReadonlySet<string>;
  onSelect: (id: string, additive: boolean) => void;
  onHover: (id: string | null) => void;
  onToggle: (flag: "locked" | "hidden", id: string) => void;
}) {
  const selected = new Set(selectedIds);
  const labels = layerLabels(structures);
  const iconButton = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--muted)] hover:border-[var(--paper)]/20 hover:text-[var(--paper)] aria-pressed:text-[var(--peach)]";
  return <div className="px-3 py-3" data-testid="map-layers">
    <h3 className={sectionHeading}>Layers</h3>
    <ul className="mt-2 space-y-1" onPointerLeave={() => onHover(null)}>
      {structures.length === 0 && <li className="text-muted text-[11px] leading-relaxed">Placed structures appear here.</li>}
      {[...structures].reverse().map((structure) => {
        const isSelected = selected.has(structure.id);
        const locked = lockedIds.has(structure.id);
        const hidden = hiddenIds.has(structure.id);
        const label = labels.get(structure.id)!;
        return <li
          key={structure.id}
          className={`flex items-center gap-0.5 rounded-md border pr-0.5 text-xs transition-colors ${isSelected ? "border-[var(--accent)]/90 bg-[var(--accent)]/15" : "border-[var(--paper)]/10 bg-[var(--input)]/85 hover:border-[var(--muted)]/70"}`}
          onPointerEnter={() => onHover(hidden ? null : structure.id)}
        >
          <button
            type="button"
            aria-pressed={isSelected}
            disabled={locked || hidden}
            title={locked ? "Locked: unlock to select it" : hidden ? "Hidden: show it to select it" : undefined}
            className={`flex min-w-0 flex-1 items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[var(--paper)] disabled:cursor-default ${hidden ? "opacity-50" : ""}`}
            onClick={(event) => onSelect(structure.id, event.shiftKey || event.ctrlKey || event.metaKey)}
          >
            <span className="truncate">{label.name}{structure.group_id ? " · group" : ""}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-[var(--muted)]">{label.size}</span>
          </button>
          <button type="button" className={iconButton} aria-pressed={locked} aria-label={`Lock ${label.name}`} title={locked ? "Unlock" : "Lock"} onClick={() => onToggle("locked", structure.id)}>
            {locked ? <LockSimple size={14} weight="fill" aria-hidden="true" /> : <LockSimpleOpen size={14} aria-hidden="true" />}
          </button>
          <button type="button" className={iconButton} aria-pressed={hidden} aria-label={`Hide ${label.name}`} title={hidden ? "Show" : "Hide"} onClick={() => onToggle("hidden", structure.id)}>
            {hidden ? <EyeSlash size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          </button>
        </li>;
      })}
    </ul>
  </div>;
}
