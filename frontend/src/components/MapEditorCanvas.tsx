import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { GameMap, MapStructure } from "../api/types";
import { rotateGeometry, scaleGeometry, type Point } from "../lib/geometryTransforms";
import { altKeyName } from "../lib/platform";
import { nearestVertex, scaleFactorTowards, snapMoveDelta, snapPoint, structureVertices, type Snapped } from "../lib/snapping";
import { expandToGroups } from "../lib/structureGroups";
import { drawStructureShape, isAreaKind, structureColor } from "../lib/structureStyle";
import { stampGeometry, structureLabel } from "../lib/structures";
import { useAssetImage } from "../lib/useAssetImage";
import { EditorContextMenu, type EditorAction } from "./EditorContextMenu";

/** "select" picks and transforms structures, "place" stamps fixed pieces, "draw" draws walls and areas point by point. */
export type EditorTool = "select" | "place" | "draw";
export type StampSettings = { kind: string; rotationDeg: number; scalePercent: number };
type HoverState = { structure: MapStructure; canvasX: number; canvasY: number };
export type TransformAction = "move" | "resize" | "rotate";
export type StructureGeometryChange = { id: string; geometry: Point[] };
type ResizeHandle = "nw" | "ne" | "se" | "sw";
type GeometryFrame = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  center: Point;
};
type TransformState = {
  action: TransformAction;
  from: Point;
  original: StructureGeometryChange[];
  current: StructureGeometryChange[];
  /** Frame of the targets when the drag started; rotation draws it turned by `degrees`. */
  frame: GeometryFrame;
  anchor: Point;
  /** Moves: the corner of the targets nearest the grab point, which snaps. Resizes: the dragged handle. */
  grip: Point;
  startValue: number;
  degrees: number;
  moved: boolean;
};
type HandleHit = { kind: "rotate" } | { kind: "resize"; handle: ResizeHandle; point: Point; anchor: Point };
type PanState = {
  x: number;
  y: number;
  camera: Point;
  moved: boolean;
};
type MarqueeState = {
  from: Point;
  to: Point;
  clientX: number;
  clientY: number;
  additive: boolean;
  moved: boolean;
};
type ContextMenuState = Point & { target: "selection" | "map" };

type Props = {
  map: GameMap;
  structures: MapStructure[];
  selectedStructureIds?: string[];
  tool?: EditorTool;
  /** The brush of the Place and Draw tools. */
  stamp?: StampSettings;
  /** Right-click menu entries for the selection. */
  contextActions?: EditorAction[];
  /** Right-click menu entries for empty map space. */
  mapContextActions?: EditorAction[];
  /** Structures not drawn and not pickable in the editor. */
  hiddenIds?: ReadonlySet<string>;
  /** Structures that are drawn but can't be selected or moved. */
  lockedIds?: ReadonlySet<string>;
  /** A structure to outline, e.g. the layer row under the pointer. */
  highlightId?: string | null;
  controls?: ReactNode;
  selector?: ReactNode;
  /** Shown at the right end of the status bar. */
  status?: ReactNode;
  onSelectStructures?: (structureIds: string[]) => void;
  onTransformStructures?: (changes: StructureGeometryChange[], action: TransformAction) => void;
  onPlace?: (point: Point) => void;
  /** A finished Draw tool shape; areas arrive closed (last point equals the first). */
  onDrawShape?: (geometry: Point[]) => void;
  onContextAction?: (id: string) => void;
};

const scale = 24;
const defaultViewport = { width: 720, height: 420 };
const initialCamera = { x: 72, y: 72 };
const dragThreshold = 3;
/** Screen pixels between the top of the selection frame and the rotation handle. */
const rotateHandleOffset = 28;
const rotateHandleRadius = 7;
const handleHitRadius = 12;
/** Screen pixels within which a point sticks to a structure corner instead of the grid. */
const snapRadiusPixels = 12;
const noSelection: string[] = [];
const noActions: EditorAction[] = [];
const noIds: ReadonlySet<string> = new Set();
const n = (value: number | string | undefined, fallback = 0) =>
  typeof value === "number" ? value : value ? Number(value) : fallback;
const toCanvas = (point: Point) => ({ x: point.x * scale, y: point.y * scale });
const round = (value: number) => Math.round(value * 100) / 100;
const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;

export function MapEditorCanvas({
  map,
  structures,
  selectedStructureIds = noSelection,
  tool = "select",
  stamp,
  contextActions = noActions,
  mapContextActions = noActions,
  hiddenIds = noIds,
  lockedIds = noIds,
  highlightId = null,
  controls,
  selector,
  status,
  onSelectStructures,
  onTransformStructures,
  onPlace,
  onDrawShape,
  onContextAction,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const pointerActive = useRef(false);
  const spaceHeld = useRef(false);
  const transformRef = useRef<TransformState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [transform, setTransform] = useState<TransformState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [camera, setCamera] = useState(initialCamera);
  const [viewportSize, setViewportSize] = useState(defaultViewport);
  const [placePoint, setPlacePoint] = useState<Point | null>(null);
  const [drawPoints, setDrawPoints] = useState<Point[]>([]);
  const [drawCursor, setDrawCursor] = useState<Snapped | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const background = useAssetImage(map.background_asset_id);
  const selecting = tool === "select";
  const drawing = tool === "draw";
  const brushKind = stamp?.kind ?? "wall";
  const grid = n(map.grid_size_m, 1);
  const items = useMemo(() => {
    const shown = hiddenIds.size > 0 ? structures.filter((structure) => !hiddenIds.has(structure.id)) : structures;
    if (!transform) return shown;
    const transformed = new Map(transform.current.map((change) => [change.id, change.geometry]));
    return shown.map((structure) => {
      const geometry = transformed.get(structure.id);
      return geometry ? { ...structure, geometry } : structure;
    });
  }, [structures, transform, hiddenIds]);
  const pickable = useMemo(() => items.filter((structure) => !lockedIds.has(structure.id)), [items, lockedIds]);
  const selectedIds = useMemo(() => new Set(selectedStructureIds), [selectedStructureIds]);
  const selectedItems = useMemo(() => items.filter((structure) => selectedIds.has(structure.id)), [items, selectedIds]);
  const targetFrame = selecting && selectedItems.length > 0 ? geometryFrame(selectedItems.flatMap((structure) => structure.geometry)) : null;
  const ghost = useMemo(
    () => tool === "place" && stamp && placePoint ? stampGeometry(stamp.kind, placePoint, grid, stamp.rotationDeg, stamp.scalePercent) : null,
    [tool, stamp?.kind, stamp?.rotationDeg, stamp?.scalePercent, placePoint, grid],
  );
  const marqueeIds = useMemo(() => {
    if (!marquee?.moved) return null;
    const rect = rectFromPoints(marquee.from, marquee.to);
    return new Set(pickable.filter((structure) => geometryIntersectsRect(structure.geometry, rect)).map((structure) => structure.id));
  }, [marquee, pickable]);

  /** Snapping for a pointer: grid corners, or corners of visible structures (other than `exclude`) within reach. */
  const snapOptions = (free: boolean, exclude?: ReadonlySet<string>, extra: Point[] = []) => ({
    grid,
    points: [...structureVertices(items, exclude), ...extra],
    radius: snapRadiusPixels / (scale * zoom),
    free,
  });

  const canvasPoint = (event: Pick<PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>, "currentTarget" | "clientX" | "clientY">) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - camera.x) / (scale * zoom),
      y: (event.clientY - rect.top - camera.y) / (scale * zoom),
    };
  };

  const shellPixels = (event: Pick<PointerEvent<HTMLCanvasElement>, "currentTarget" | "clientX" | "clientY">) => {
    const rect = shellRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = ref.current;
    if (!viewport || !canvas) return;
    const measure = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      setViewportSize({
        width: Math.max(1, Math.round(viewportRect.width || canvasRect.width || defaultViewport.width)),
        height: Math.max(1, Math.round(viewportRect.height || canvasRect.height || defaultViewport.height)),
      });
    };
    measure();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const nextZoom = Math.min(3, Math.max(0.35, round(zoom + (event.deltaY < 0 ? 0.15 : -0.15))));
      if (nextZoom === zoom) return;
      const ratio = nextZoom / zoom;
      setCamera({
        x: pointer.x - (pointer.x - camera.x) * ratio,
        y: pointer.y - (pointer.y - camera.y) * ratio,
      });
      setZoom(nextZoom);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [camera, zoom]);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, viewportSize.width);
    const height = Math.max(1, viewportSize.height);
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#141019";
    ctx.fillRect(0, 0, width, height);

    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, camera.x * dpr, camera.y * dpr);
    const visibleLeft = -camera.x / zoom;
    const visibleTop = -camera.y / zoom;
    const visibleRight = (width - camera.x) / zoom;
    const visibleBottom = (height - camera.y) / zoom;
    const gridPixels = Math.max(grid * scale, 1);
    const mapWidth = n(map.width_m, 30) * scale;
    const mapHeight = n(map.height_m, 30) * scale;

    ctx.fillStyle = "#18151e";
    ctx.fillRect(visibleLeft, visibleTop, visibleRight - visibleLeft, visibleBottom - visibleTop);
    ctx.fillStyle = "#221c2b";
    ctx.fillRect(0, 0, mapWidth, mapHeight);
    // The background is stretched to the map's size, under the grid.
    if (background) ctx.drawImage(background, 0, 0, mapWidth, mapHeight);

    ctx.lineWidth = 1 / zoom;
    for (let x = Math.floor(visibleLeft / gridPixels) * gridPixels; x <= visibleRight; x += gridPixels) {
      const major = Math.round(x / gridPixels) % 5 === 0;
      ctx.strokeStyle = major ? "rgba(235,199,255,0.22)" : "rgba(235,199,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(x, visibleTop);
      ctx.lineTo(x, visibleBottom);
      ctx.stroke();
    }
    for (let y = Math.floor(visibleTop / gridPixels) * gridPixels; y <= visibleBottom; y += gridPixels) {
      const major = Math.round(y / gridPixels) % 5 === 0;
      ctx.strokeStyle = major ? "rgba(235,199,255,0.22)" : "rgba(235,199,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(visibleLeft, y);
      ctx.lineTo(visibleRight, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "#be8cff";
    ctx.lineWidth = 3 / zoom;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(mapWidth, 0);
    ctx.lineTo(mapWidth, mapHeight);
    ctx.lineTo(0, mapHeight);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "rgba(20,16,25,0.85)";
    ctx.lineWidth = 10 / zoom;
    ctx.setLineDash([1 / zoom, 10 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    const highlighted = new Set(selecting ? selectedItems.map((structure) => structure.id) : []);
    marqueeIds?.forEach((id) => highlighted.add(id));
    items.forEach((structure) => drawStructureShape(ctx, structure.kind, structure.geometry, {
      scale,
      blocksVision: structure.blocks_vision,
      halo: highlighted.has(structure.id) ? "selected" : structure.id === highlightId ? "hover" : undefined,
    }));
    if (ghost) drawStructureShape(ctx, brushKind, ghost, { scale, ghost: true });
    if (drawing) drawDraft(ctx, brushKind, drawPoints, drawCursor, zoom);
    if (transform?.action === "rotate") drawSelectionFrame(ctx, transform.frame, zoom, transform.degrees);
    else if (targetFrame) drawSelectionFrame(ctx, targetFrame, zoom, 0);
    if (marquee?.moved) drawMarquee(ctx, marquee, zoom);
  }, [background, brushKind, camera, drawCursor, drawPoints, drawing, ghost, grid, highlightId, items, map.height_m, map.width_m, marquee, marqueeIds, selecting, selectedItems, targetFrame?.minX, targetFrame?.minY, targetFrame?.maxX, targetFrame?.maxY, transform, viewportSize, zoom]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [contextMenu]);

  const hasSelection = selectedStructureIds.length > 0;
  // The selection menu acts on the selection: drop it when the tool changes or the selection goes away (e.g. Delete).
  useEffect(() => {
    if (!selecting || !hasSelection) setContextMenu((current) => current?.target === "map" && selecting ? current : null);
  }, [selecting, hasSelection]);

  // A shape in progress belongs to the Draw tool and its brush.
  useEffect(() => {
    setDrawPoints([]);
    if (!drawing) setDrawCursor(null);
  }, [drawing, brushKind]);

  /** Ends the shape being drawn. Areas need three corners and close themselves; lines need two. */
  const finishDraw = (close = false) => {
    const area = isAreaKind(brushKind);
    if (drawPoints.length < (area || close ? 3 : 2)) return false;
    onDrawShape?.(area || close ? [...drawPoints, drawPoints[0]] : drawPoints);
    setDrawPoints([]);
    return true;
  };
  const finishDrawRef = useRef(finishDraw);
  finishDrawRef.current = finishDraw;
  useEffect(() => {
    if (!drawing || drawPoints.length === 0) return;
    // Captured before the page's shortcuts, so Enter, Escape and Backspace act on the shape first.
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select")))) return;
      if (event.key === "Enter") finishDrawRef.current();
      else if (event.key === "Escape") setDrawPoints([]);
      else if (event.key === "Backspace" || event.key === "Delete") setDrawPoints((current) => current.slice(0, -1));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [drawing, drawPoints.length]);

  const pickTarget = (point: Point) =>
    pickStructure(selectedItems, point) ?? pickStructure([...pickable].reverse(), point);
  /** Every selection the canvas emits includes whole groups, without locked or hidden structures. Returns the expanded ids. */
  const select = (ids: string[]) => {
    const next = expandToGroups(ids, structures).filter((id) => !lockedIds.has(id) && !hiddenIds.has(id));
    if (next.length !== selectedStructureIds.length || !next.every((id) => selectedIds.has(id))) onSelectStructures?.(next);
    return next;
  };
  const updateTransform = (next: TransformState | null) => {
    transformRef.current = next;
    setTransform(next);
  };
  const updateMarquee = (next: MarqueeState | null) => {
    marqueeRef.current = next;
    setMarquee(next);
  };
  const clearPointerAction = () => {
    pointerActive.current = false;
    updateTransform(null);
    updateMarquee(null);
    panRef.current = null;
  };
  const beginTransform = (action: TransformAction, transformTargets: MapStructure[], point: Point, hit?: HandleHit) => {
    const original = transformTargets.map((structure) => ({ id: structure.id, geometry: structure.geometry }));
    const frame = geometryFrame(original.flatMap((change) => change.geometry));
    const anchor = hit?.kind === "resize" ? hit.anchor : frame.center;
    updateTransform({
      action,
      from: point,
      original,
      current: original,
      frame,
      anchor,
      grip: hit?.kind === "resize" ? hit.point : nearestVertex(original.flatMap((change) => change.geometry), point),
      startValue: action === "resize"
        ? Math.hypot(point.x - anchor.x, point.y - anchor.y)
        : Math.atan2(point.y - anchor.y, point.x - anchor.x),
      degrees: 0,
      moved: false,
    });
  };
  const cursorAt = (point: Point) => {
    if (spaceHeld.current) return "grab";
    if (!selecting) return "crosshair";
    if (targetFrame) {
      const hit = hitSelectionHandle(selectedItems, targetFrame, point, zoom);
      if (hit) return cursorForHandle(hit);
    }
    if (pickTarget(point) || (targetFrame && pointInFrame(targetFrame, point, zoom))) return "move";
    return "default";
  };
  const openContextMenu = (event: PointerEvent<HTMLCanvasElement>) => {
    const picked = pickTarget(canvasPoint(event));
    if (picked && contextActions.length > 0) {
      if (!selectedIds.has(picked.id)) select([picked.id]);
      setContextMenu({ ...shellPixels(event), target: "selection" });
    } else if (!picked && mapContextActions.length > 0) {
      setContextMenu({ ...shellPixels(event), target: "map" });
    }
  };
  const closeContextMenu = () => {
    setContextMenu(null);
    ref.current?.focus({ preventScroll: true });
  };

  const brushName = structureLabel(brushKind).toLowerCase();
  const helpText = transform
    ? `Esc cancels · hold ${altKeyName} to place freely · Shift ${transform.action === "rotate" ? "snaps to 15°" : "locks to one axis"}`
    : selecting
      ? "Drag to move (snaps to the grid) · corners resize · round handle rotates · right-drag or Space-drag pans · right-click for more"
      : drawing
        ? drawPoints.length === 0
          ? `Click to start a ${brushName} · corners snap to the grid · hold ${altKeyName} for free placement`
          : `Click to add corners · Enter or double-click finishes${isAreaKind(brushKind) ? "" : " · click the first point to close"} · Backspace removes a corner · Esc cancels`
        : "Click to place · Q/E rotate · [ ] resize · Esc returns to Select";
  const selectionLabel = drawing
    ? `Drawing ${brushName}${drawPoints.length > 0 ? ` · ${drawPoints.length} ${drawPoints.length === 1 ? "point" : "points"}` : ""}`
    : !selecting
      ? `Placing ${brushName}`
      : selectedItems.length > 1
        ? `${selectedItems.length} structures selected`
        : selectedItems.length === 1 ? `${structureLabel(selectedItems[0].kind)} selected` : "Nothing selected";

  return (
    <div ref={shellRef} className="relative overflow-hidden rounded-2xl border border-[var(--accent)]/25 bg-[var(--input)] shadow-[0_24px_80px_rgba(0,0,0,0.35)]" data-testid="map-editor-shell">
      <div className="pointer-events-none absolute bottom-16 left-4 top-4 z-20 flex items-start">
        <div
          className="pointer-events-auto flex max-h-full w-[160px] flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--accent)]/20 bg-[var(--input)] p-2 shadow-2xl"
          data-testid="map-editor-toolbar"
          aria-label="Canvas toolbar"
        >
          <div className="grid gap-1 border-b border-[var(--paper)]/10 pb-2">
            <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">View</span>
            <div className="grid grid-cols-3 items-center gap-1">
              <button className="btn-secondary h-9 min-h-0 w-full whitespace-nowrap px-2 py-1.5 text-xs" type="button" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(0.35, round(current - 0.15)))}>−</button>
              <button className="btn-secondary h-9 min-h-0 w-full whitespace-nowrap px-1 py-1.5 text-[10px] tabular-nums" type="button" aria-label="Reset view" title="Reset view" onClick={() => { setZoom(0.85); setCamera(initialCamera); }}>{Math.round(zoom * 100)}%</button>
              <button className="btn-secondary h-9 min-h-0 w-full whitespace-nowrap px-2 py-1.5 text-xs" type="button" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(3, round(current + 0.15)))}>+</button>
            </div>
            <p className="text-muted mb-0 px-1 text-[10px] leading-snug">Drag to pan with the right or middle button, or hold Space. Scroll to zoom.</p>
          </div>
          {controls}
        </div>
      </div>
      {selector && <div className="pointer-events-none absolute bottom-16 right-4 top-4 z-20 flex items-start">
        <div
          className="pointer-events-auto flex h-full max-h-full w-[230px] flex-col overflow-hidden rounded-xl border border-[var(--accent)]/20 bg-[var(--input)] shadow-2xl"
          data-testid="map-editor-selector"
          aria-label="Structure selector"
        >
          {selector}
        </div>
      </div>}
      <div
        ref={viewportRef}
        className="h-[640px] max-h-[74vh] min-h-[520px] overflow-hidden overscroll-contain bg-[var(--ink)]"
        data-testid="map-editor-viewport"
        aria-label="Infinite map editor canvas viewport"
      >
        <canvas
          ref={ref}
          className="block h-full w-full touch-none bg-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
          data-testid="map-editor-canvas"
          role="img"
          tabIndex={0}
          aria-describedby="map-editor-transform-help"
          aria-label={selecting
            ? "Map canvas, Select tool. Click a structure to select it, Shift-click to add or remove it, or drag across empty space to select an area. Drag the selection to move it, a corner handle to resize it, or the round handle to rotate it; moves and resizes snap to the grid unless you hold Alt. Right-click for actions."
            : drawing
              ? "Map canvas, Draw tool. Click to add corners, which snap to the grid and to nearby corners unless you hold Alt. Press Enter or double-click to finish, Escape to cancel."
              : "Map canvas, Place tool. Click to place the stamp shown under the pointer; Q and E rotate it, [ and ] resize it, Escape returns to the Select tool."}
          onContextMenu={(event) => event.preventDefault()}
          onDoubleClick={() => {
            if (drawing) finishDraw();
          }}
          onPointerDown={(event) => {
            setContextMenu(null);
            if (pointerActive.current) return;
            const panGesture = event.button === 1 || event.button === 2 || (event.button === 0 && spaceHeld.current);
            if (!panGesture && event.button !== 0) return;
            event.currentTarget.focus({ preventScroll: true });
            if (!panGesture && tool === "place") {
              onPlace?.(canvasPoint(event));
              return;
            }
            if (!panGesture && drawing) {
              const snapped = snapPoint(canvasPoint(event), snapOptions(event.altKey, undefined, drawPoints)).point;
              if (drawPoints.length > 0 && samePoint(snapped, drawPoints[drawPoints.length - 1])) return;
              if (drawPoints.length >= 3 && samePoint(snapped, drawPoints[0])) {
                finishDraw(true);
                return;
              }
              setDrawPoints([...drawPoints, snapped]);
              return;
            }
            event.currentTarget.setPointerCapture?.(event.pointerId);
            pointerActive.current = true;
            setHover(null);
            if (panGesture) {
              panRef.current = { x: event.clientX, y: event.clientY, camera, moved: false };
              event.currentTarget.style.cursor = "grabbing";
              return;
            }
            const point = canvasPoint(event);
            if (targetFrame) {
              const hit = hitSelectionHandle(selectedItems, targetFrame, point, zoom);
              if (hit) {
                beginTransform(hit.kind === "rotate" ? "rotate" : "resize", selectedItems, point, hit);
                event.currentTarget.style.cursor = hit.kind === "rotate" ? "grabbing" : cursorForHandle(hit);
                return;
              }
            }
            const picked = pickTarget(point);
            if (picked && (event.shiftKey || event.ctrlKey || event.metaKey)) {
              if (selectedIds.has(picked.id)) {
                const group = new Set(expandToGroups([picked.id], structures));
                select(selectedStructureIds.filter((id) => !group.has(id)));
              } else {
                select([...selectedStructureIds, picked.id]);
              }
              pointerActive.current = false;
              return;
            }
            if (picked) {
              let transformTargets = selectedItems;
              if (!selectedIds.has(picked.id)) {
                const group = new Set(select([picked.id]));
                transformTargets = items.filter((structure) => group.has(structure.id));
              }
              beginTransform("move", transformTargets, point);
              event.currentTarget.style.cursor = "grabbing";
              return;
            }
            if (targetFrame && pointInFrame(targetFrame, point, zoom)) {
              beginTransform("move", selectedItems, point);
              event.currentTarget.style.cursor = "grabbing";
              return;
            }
            updateMarquee({ from: point, to: point, clientX: event.clientX, clientY: event.clientY, additive: event.shiftKey || event.ctrlKey || event.metaKey, moved: false });
          }}
          onPointerMove={(event) => {
            const point = canvasPoint(event);
            const activeTransform = transformRef.current;
            if (pointerActive.current && activeTransform) {
              if (!activeTransform.moved && Math.hypot(point.x - activeTransform.from.x, point.y - activeTransform.from.y) * scale * zoom < dragThreshold) return;
              const targets = new Set(activeTransform.original.map((change) => change.id));
              let degrees = 0;
              let transformGeometry: (geometry: Point[]) => Point[];
              if (activeTransform.action === "move") {
                const raw = { x: point.x - activeTransform.from.x, y: point.y - activeTransform.from.y };
                const lock = event.shiftKey ? (Math.abs(raw.x) >= Math.abs(raw.y) ? "y" : "x") : undefined;
                // The grabbed corner lands on a grid corner or another structure's corner.
                const delta = snapMoveDelta(activeTransform.grip, raw, snapOptions(event.altKey, targets), lock);
                transformGeometry = (geometry) => geometry.map((vertex) => ({ x: round(vertex.x + delta.x), y: round(vertex.y + delta.y) }));
              } else if (activeTransform.action === "resize") {
                const anchor = activeTransform.anchor;
                const factor = event.altKey
                  ? Math.max(0.08, Math.hypot(point.x - anchor.x, point.y - anchor.y) / Math.max(activeTransform.startValue, 0.001))
                  : scaleFactorTowards(anchor, activeTransform.grip, snapPoint(point, snapOptions(false, targets)).point);
                transformGeometry = (geometry) => scaleGeometry(geometry, factor, anchor);
              } else {
                const center = activeTransform.anchor;
                degrees = (Math.atan2(point.y - center.y, point.x - center.x) - activeTransform.startValue) * 180 / Math.PI;
                if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
                transformGeometry = (geometry) => rotateGeometry(geometry, degrees, center);
              }
              const current = activeTransform.original.map((change) => ({ id: change.id, geometry: transformGeometry(change.geometry) }));
              updateTransform({ ...activeTransform, current, degrees, moved: true });
              return;
            }
            const activePan = panRef.current;
            if (pointerActive.current && activePan) {
              const dx = event.clientX - activePan.x;
              const dy = event.clientY - activePan.y;
              if (!activePan.moved && Math.hypot(dx, dy) < dragThreshold) return;
              activePan.moved = true;
              setCamera({ x: activePan.camera.x + dx, y: activePan.camera.y + dy });
              return;
            }
            const activeMarquee = marqueeRef.current;
            if (pointerActive.current && activeMarquee) {
              if (!activeMarquee.moved && Math.hypot(event.clientX - activeMarquee.clientX, event.clientY - activeMarquee.clientY) < dragThreshold) return;
              updateMarquee({ ...activeMarquee, to: point, moved: true });
              return;
            }
            event.currentTarget.style.cursor = cursorAt(point);
            if (drawing) {
              setDrawCursor(snapPoint(point, snapOptions(event.altKey, undefined, drawPoints)));
              return;
            }
            if (!selecting) {
              setPlacePoint(point);
              setHover(null);
              return;
            }
            const picked = targetFrame && hitSelectionHandle(selectedItems, targetFrame, point, zoom) ? null : pickTarget(point);
            if (!picked) {
              setHover(null);
              return;
            }
            const px = shellPixels(event);
            setHover({ structure: picked, canvasX: px.x, canvasY: px.y });
          }}
          onPointerUp={(event) => {
            if (!pointerActive.current) return;
            const activeTransform = transformRef.current;
            const activeMarquee = marqueeRef.current;
            const activePan = panRef.current;
            if (activeTransform?.moved) {
              onTransformStructures?.(activeTransform.current, activeTransform.action);
            } else if (activeMarquee?.moved) {
              const base = activeMarquee.additive ? selectedStructureIds : [];
              const inside = pickable
                .filter((structure) => geometryIntersectsRect(structure.geometry, rectFromPoints(activeMarquee.from, activeMarquee.to)))
                .map((structure) => structure.id);
              select([...base, ...inside.filter((id) => !base.includes(id))]);
            } else if (activeMarquee && !activeMarquee.additive) {
              if (selectedStructureIds.length > 0) select([]);
            } else if (activePan && !activePan.moved && event.button === 2 && selecting) {
              openContextMenu(event);
            }
            clearPointerAction();
            event.currentTarget.style.cursor = cursorAt(canvasPoint(event));
          }}
          onPointerCancel={(event) => {
            clearPointerAction();
            setHover(null);
            event.currentTarget.style.cursor = "default";
          }}
          onPointerLeave={() => {
            if (pointerActive.current) return;
            setHover(null);
            setPlacePoint(null);
            setDrawCursor(null);
          }}
          onBlur={() => {
            spaceHeld.current = false;
          }}
          onKeyUp={(event) => {
            if (event.key === " ") spaceHeld.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              spaceHeld.current = true;
              if (!pointerActive.current) event.currentTarget.style.cursor = "grab";
              return;
            }
            if (event.key === "Escape" && pointerActive.current) {
              event.preventDefault();
              clearPointerAction();
              event.currentTarget.style.cursor = "default";
            }
          }}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex items-center gap-3 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-[11px] text-[var(--muted)] shadow-xl">
        <div id="map-editor-transform-help" className="flex min-w-0 flex-1 items-center gap-2" role="status" aria-live="polite">
          <strong className="shrink-0 font-semibold text-[var(--paper)]">{selectionLabel}</strong>
          <span aria-hidden="true">·</span>
          <span className="truncate">{helpText}</span>
        </div>
        {status && <div className="pointer-events-auto flex shrink-0 items-center gap-3">{status}</div>}
      </div>
      {hover && selecting && !transform && !marquee?.moved && <StructureTooltip hover={hover} viewportSize={viewportSize} />}
      {contextMenu && <EditorContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        label={contextMenu.target === "selection" ? "Structure actions" : "Map actions"}
        actions={contextMenu.target === "selection" ? contextActions : mapContextActions}
        onClose={closeContextMenu}
        onAction={(id) => {
          closeContextMenu();
          onContextAction?.(id);
        }}
      />}
    </div>
  );
}

/** The Draw tool's shape so far, the rubber band to the pointer, and a marker where the next corner snaps. */
function drawDraft(ctx: CanvasRenderingContext2D, kind: string, points: Point[], cursor: Snapped | null, zoom: number) {
  const path = cursor ? [...points, cursor.point] : points;
  if (path.length > 1) drawStructureShape(ctx, kind, isAreaKind(kind) && path.length > 2 ? [...path, path[0]] : path, { scale, ghost: true });
  ctx.fillStyle = structureColor(kind);
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x * scale, point.y * scale, 3.5 / zoom, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!cursor) return;
  ctx.strokeStyle = cursor.kind === "point" ? "#ffb887" : "#f6effa";
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  ctx.arc(cursor.point.x * scale, cursor.point.y * scale, (cursor.kind === "point" ? 8 : 5) / zoom, 0, Math.PI * 2);
  ctx.stroke();
}

/** Draws the dashed frame, square resize handles and the round rotation handle, turned by `degrees` around the frame center. */
function drawSelectionFrame(ctx: CanvasRenderingContext2D, frame: GeometryFrame, zoom: number, degrees: number) {
  const turn = (point: Point) => toCanvas(degrees === 0 ? point : rotatePoint(point, frame.center, degrees));
  const corners = resizeHandles(frame).map(({ point }) => turn(point));
  const topCenter = turn({ x: frame.center.x, y: frame.minY });
  const handle = turn(rotateHandlePoint(frame, zoom));
  const handleSize = 10 / zoom;

  ctx.strokeStyle = "#f6effa";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  corners.forEach((corner, index) => {
    if (index === 0) ctx.moveTo(corner.x, corner.y);
    else ctx.lineTo(corner.x, corner.y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(topCenter.x, topCenter.y);
  ctx.lineTo(handle.x, handle.y);
  ctx.stroke();

  ctx.fillStyle = "#f6effa";
  for (const corner of corners) {
    ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
  }
  ctx.fillStyle = "#be8cff";
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  ctx.arc(handle.x, handle.y, rotateHandleRadius / zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawMarquee(ctx: CanvasRenderingContext2D, marquee: MarqueeState, zoom: number) {
  const rect = rectFromPoints(marquee.from, marquee.to);
  const left = rect.minX * scale;
  const top = rect.minY * scale;
  const width = (rect.maxX - rect.minX) * scale;
  const height = (rect.maxY - rect.minY) * scale;
  ctx.fillStyle = "rgba(190,140,255,0.12)";
  ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = "#be8cff";
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 3 / zoom]);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + width, top);
  ctx.lineTo(left + width, top + height);
  ctx.lineTo(left, top + height);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

function rotatePoint(point: Point, center: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function rotateHandlePoint(frame: GeometryFrame, zoom: number): Point {
  return { x: frame.center.x, y: frame.minY - rotateHandleOffset / (scale * zoom) };
}

function geometryFrame(geometry: Point[]): GeometryFrame {
  if (geometry.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, center: { x: 0, y: 0 } };
  let minX = geometry[0].x;
  let minY = geometry[0].y;
  let maxX = geometry[0].x;
  let maxY = geometry[0].y;
  for (let index = 1; index < geometry.length; index += 1) {
    const point = geometry[index];
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } };
}

function rectFromPoints(a: Point, b: Point): GeometryFrame {
  return geometryFrame([a, b]);
}

function resizeHandles(frame: GeometryFrame) {
  return [
    { handle: "nw" as const, point: { x: frame.minX, y: frame.minY }, anchor: { x: frame.maxX, y: frame.maxY } },
    { handle: "ne" as const, point: { x: frame.maxX, y: frame.minY }, anchor: { x: frame.minX, y: frame.maxY } },
    { handle: "se" as const, point: { x: frame.maxX, y: frame.maxY }, anchor: { x: frame.minX, y: frame.minY } },
    { handle: "sw" as const, point: { x: frame.minX, y: frame.maxY }, anchor: { x: frame.maxX, y: frame.minY } },
  ];
}

function hitSelectionHandle(targets: MapStructure[], frame: GeometryFrame, point: Point, zoom: number): HandleHit | null {
  const radius = handleHitRadius / (scale * zoom);
  const rotateHandle = rotateHandlePoint(frame, zoom);
  if (Math.hypot(point.x - rotateHandle.x, point.y - rotateHandle.y) <= radius) return { kind: "rotate" };
  // A lone two-point wall stretches from the grabbed endpoint while its other endpoint stays put.
  const endpoints = targets.length === 1 && targets[0].geometry.length === 2 ? targets[0].geometry : null;
  for (const handle of resizeHandles(frame)) {
    if (Math.hypot(point.x - handle.point.x, point.y - handle.point.y) > radius) continue;
    const endpointIndex = endpoints ? endpoints.findIndex((endpoint) => endpoint.x === handle.point.x && endpoint.y === handle.point.y) : -1;
    const onEndpoint = endpoints && endpointIndex !== -1;
    return {
      kind: "resize",
      handle: handle.handle,
      point: onEndpoint ? endpoints[endpointIndex] : handle.point,
      anchor: onEndpoint ? endpoints[endpointIndex === 0 ? 1 : 0] : handle.anchor,
    };
  }
  return null;
}

function pointInFrame(frame: GeometryFrame, point: Point, zoom: number) {
  const padding = 10 / (scale * zoom);
  return point.x >= frame.minX - padding
    && point.x <= frame.maxX + padding
    && point.y >= frame.minY - padding
    && point.y <= frame.maxY + padding;
}

function cursorForHandle(hit: HandleHit) {
  if (hit.kind === "rotate") return "grab";
  return hit.handle === "nw" || hit.handle === "se" ? "nwse-resize" : "nesw-resize";
}

function pickStructure(structures: MapStructure[], point: Point) {
  const tolerance = 0.35;
  return structures.find((structure) => distanceToGeometry(point, structure.geometry) <= tolerance) ?? null;
}

function geometryIntersectsRect(geometry: Point[], rect: GeometryFrame) {
  const inside = (point: Point) => point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
  if (geometry.some(inside)) return true;
  const corners = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  for (let i = 1; i < geometry.length; i += 1) {
    for (let edge = 0; edge < corners.length; edge += 1) {
      if (segmentsIntersect(geometry[i - 1], geometry[i], corners[edge], corners[(edge + 1) % corners.length])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function distanceToGeometry(point: Point, geometry: Point[]) {
  if (geometry.length === 0) return Number.POSITIVE_INFINITY;
  if (geometry.length === 1) return Math.hypot(point.x - geometry[0].x, point.y - geometry[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < geometry.length; i += 1) {
    best = Math.min(best, distanceToSegment(point, geometry[i - 1], geometry[i]));
  }
  return best;
}

function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function StructureTooltip({ hover, viewportSize }: { hover: HoverState; viewportSize: { width: number; height: number } }) {
  const structure = hover.structure;
  const offset = 16;
  const width = 272;
  const estimatedHeight = Object.keys(structure.pass_rules ?? {}).length > 0 ? 280 : 236;
  const left = Math.max(12, Math.min(hover.canvasX + offset, viewportSize.width - width - 12));
  const top = Math.max(12, Math.min(hover.canvasY + offset, viewportSize.height - estimatedHeight - 12));

  return (
    <div
      className="pointer-events-none absolute z-40 w-[272px] rounded-xl border border-[var(--paper)]/25 bg-[var(--paper)] p-4 text-sm leading-relaxed text-[var(--ink)] shadow-[0_24px_60px_rgba(0,0,0,0.45)] ring-1 ring-[var(--ink)]/15"
      style={{ left, top }}
      role="status"
    >
      <p className="font-semibold capitalize tracking-[-0.01em] text-[var(--ink)]">{structure.kind}</p>
      <dl className="mt-3 grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--line)]">Vision</dt><dd className="shrink-0 rounded-full bg-[var(--ink)] px-2.5 py-0.5 text-xs font-medium text-[var(--paper)]">{structure.blocks_vision ? "blocks" : "open"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--line)]">Movement</dt><dd className="shrink-0 rounded-full bg-[var(--ink)] px-2.5 py-0.5 text-xs font-medium text-[var(--paper)]">{structure.blocks_movement ? "blocks" : "open"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--line)]">Attacks</dt><dd className="shrink-0 rounded-full bg-[var(--ink)] px-2.5 py-0.5 text-xs font-medium text-[var(--paper)]">{structure.blocks_attacks ? "blocks" : "open"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--line)]">Cover</dt><dd className="shrink-0 font-semibold tabular-nums text-[var(--ink)]">{structure.cover_bonus}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--line)]">Points</dt><dd className="shrink-0 font-semibold tabular-nums text-[var(--ink)]">{structure.geometry.length}</dd>
        </div>
      </dl>
      {Object.keys(structure.pass_rules ?? {}).length > 0 && <p className="mt-3 break-words border-t border-[var(--ink)]/15 pt-3 text-xs font-medium text-[var(--surface-raised)]">Pass rules: {Object.entries(structure.pass_rules).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none"}</p>}
    </div>
  );
}
