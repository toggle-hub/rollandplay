import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { GameMap, MapStructure } from "../api/types";
import { rotateGeometry, scaleGeometry, type Point } from "../lib/geometryTransforms";
import { TransformRadialMenu, type TransformMode } from "./TransformRadialMenu";

type DraftStructure = Omit<MapStructure, "id" | "map_id"> & { id?: string; map_id?: string };
type HoverState = { structure: MapStructure; canvasX: number; canvasY: number };
export type TransformAction = "move" | "resize" | "rotate";
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
  id: string;
  from: Point;
  originalGeometry: Point[];
  currentGeometry: Point[];
  draft: boolean;
  moved: boolean;
  anchor?: Point;
  startValue?: number;
};
type HandleHit = { handle: ResizeHandle; anchor: Point };
type PanState = {
  x: number;
  y: number;
  camera: Point;
  moved: boolean;
};

type Props = {
  map: GameMap;
  structures: MapStructure[];
  draftStructure?: DraftStructure | null;
  selectedStructureId?: string;
  controls?: ReactNode;
  selector?: ReactNode;
  disabled?: boolean;
  onSelectStructure?: (structureId: string) => void;
  onTransformStructure?: (structureId: string, geometry: Point[], action: TransformAction) => void;
  onTransformDraft?: (geometry: Point[], action: TransformAction) => void;
  onTransformDraftEnd?: (originalGeometry: Point[], nextGeometry: Point[], action: TransformAction) => void;
  onMoveDraft?: (point: Point) => void;
};

const scale = 24;
const defaultViewport = { width: 720, height: 420 };
const initialCamera = { x: 72, y: 72 };
const draftId = "__draft__";
const dragThreshold = 3;
const n = (value: number | string | undefined, fallback = 0) =>
  typeof value === "number" ? value : value ? Number(value) : fallback;
const toCanvas = (point: Point) => ({ x: point.x * scale, y: point.y * scale });
const moveGeometry = (geometry: Point[], dx: number, dy: number) => geometry.map((point) => ({ x: round(point.x + dx), y: round(point.y + dy) }));
const round = (value: number) => Math.round(value * 100) / 100;

export function MapEditorCanvas({
  map,
  structures,
  draftStructure,
  selectedStructureId,
  controls,
  selector,
  disabled = false,
  onSelectStructure,
  onTransformStructure,
  onTransformDraft,
  onTransformDraftEnd,
  onMoveDraft,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const pointerActive = useRef(false);
  const transformRef = useRef<TransformState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [transform, setTransform] = useState<TransformState | null>(null);
  const [pan, setPan] = useState<PanState | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [camera, setCamera] = useState(initialCamera);
  const [viewportSize, setViewportSize] = useState(defaultViewport);
  const [radialMenu, setRadialMenu] = useState<{ structureId: string; x: number; y: number } | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("move");
  const items = useMemo(() => {
    const saved = structures.map((structure) => transform && !transform.draft && transform.id === structure.id ? { ...structure, geometry: transform.currentGeometry } : structure);
    if (!draftStructure?.geometry.length) return saved;
    const draftGeometry = transform?.draft ? transform.currentGeometry : draftStructure.geometry;
    return [...saved, { ...draftStructure, id: draftId, geometry: draftGeometry } as MapStructure];
  }, [draftStructure, structures, transform]);
  const activeSelection = useMemo(
    () => items.find((structure) => structure.id === selectedStructureId) ?? items.find((structure) => structure.id === draftId),
    [items, selectedStructureId],
  );
  const radialTarget = radialMenu
    ? items.find((structure) => structure.id === radialMenu.structureId)
    : undefined;

  const canvasPoint = (event: Pick<PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>, "currentTarget" | "clientX" | "clientY">) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - camera.x) / (scale * zoom),
      y: (event.clientY - rect.top - camera.y) / (scale * zoom),
    };
  };

  const shellPixels = (event: Pick<PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>, "currentTarget" | "clientX" | "clientY">) => {
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
      if (!event.ctrlKey || event.deltaY === 0) return;
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
    const grid = Math.max(n(map.grid_size_m, 1) * scale, 1);
    const mapWidth = n(map.width_m, 30) * scale;
    const mapHeight = n(map.height_m, 30) * scale;

    ctx.fillStyle = "#18151e";
    ctx.fillRect(visibleLeft, visibleTop, visibleRight - visibleLeft, visibleBottom - visibleTop);
    ctx.fillStyle = "#221c2b";
    ctx.fillRect(0, 0, mapWidth, mapHeight);
    ctx.fillStyle = "rgba(190,140,255,0.06)";
    ctx.fillRect(0, 0, mapWidth, Math.max(grid * 2, mapHeight * 0.18));
    ctx.fillStyle = "rgba(217,255,181,0.08)";
    ctx.fillRect(0, mapHeight * 0.55, mapWidth, mapHeight * 0.45);

    ctx.lineWidth = 1 / zoom;
    for (let x = Math.floor(visibleLeft / grid) * grid; x <= visibleRight; x += grid) {
      const major = Math.round(x / grid) % 5 === 0;
      ctx.strokeStyle = major ? "rgba(235,199,255,0.22)" : "rgba(235,199,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(x, visibleTop);
      ctx.lineTo(x, visibleBottom);
      ctx.stroke();
    }
    for (let y = Math.floor(visibleTop / grid) * grid; y <= visibleBottom; y += grid) {
      const major = Math.round(y / grid) % 5 === 0;
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

    items.forEach((structure) => drawStructure(ctx, structure, structure.id === activeSelection?.id));
    if (activeSelection) drawSelectionFrame(ctx, activeSelection.geometry, zoom, transformMode);
  }, [activeSelection, camera, items, map.grid_size_m, map.height_m, map.width_m, transformMode, viewportSize, zoom]);

  const pickedStructure = (point: Point) => pickStructure([...items].reverse(), point);
  const updateTransform = (next: TransformState | null) => {
    transformRef.current = next;
    setTransform(next);
  };
  const clearPointerAction = () => {
    pointerActive.current = false;
    updateTransform(null);
    panRef.current = null;
    setPan(null);
  };
  const cancelPointerAction = () => {
    const activeTransform = transformRef.current;
    if (activeTransform?.draft && activeTransform.moved) onTransformDraft?.(activeTransform.originalGeometry, activeTransform.action);
    clearPointerAction();
  };
  const beginTransform = (structure: MapStructure, action: TransformAction, point: Point, hit?: HandleHit) => {
    const frame = geometryFrame(structure.geometry);
    const next: TransformState = {
      action,
      id: structure.id,
      from: point,
      originalGeometry: structure.geometry,
      currentGeometry: structure.geometry,
      draft: structure.id === draftId,
      moved: false,
      anchor: hit?.anchor ?? frame.center,
      startValue: hit
        ? Math.hypot(point.x - hit.anchor.x, point.y - hit.anchor.y)
        : Math.atan2(point.y - frame.center.y, point.x - frame.center.x),
    };
    updateTransform(next);
    if (!next.draft) onSelectStructure?.(next.id);
  };

  useEffect(() => {
    if (!disabled) return;
    cancelPointerAction();
    setRadialMenu(null);
  }, [disabled]);

  const changeTransformMode = (mode: TransformMode) => {
    setTransformMode(mode);
    setRadialMenu(null);
    ref.current?.focus({ preventScroll: true });
  };
  return (
    <div ref={shellRef} className="relative overflow-hidden rounded-2xl border border-[var(--accent)]/25 bg-[var(--input)] shadow-[0_24px_80px_rgba(0,0,0,0.35)]" data-testid="map-editor-shell">
      <div className="pointer-events-none absolute bottom-4 left-4 top-4 z-20 flex items-start">
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
          </div>
          {controls}
        </div>
      </div>
      {selector && <div className="pointer-events-none absolute bottom-4 right-4 top-4 z-20 flex items-start">
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
          aria-label="Infinite live map canvas. Right-click a structure to choose persistent Move or Rotate mode. Drag structures in the chosen mode. In Move mode, drag square handles to resize or click empty space to place the draft. In Rotate mode, drag around the structure center; Shift snaps to 15 degrees. Drag empty space to pan, or hold Control and scroll to zoom."
          onContextMenu={(event) => {
            event.preventDefault();
            if (disabled) return;
            const point = canvasPoint(event);
            const structure = activeSelection && pointInSelectionFrame(activeSelection.geometry, point, zoom)
              ? activeSelection
              : pickedStructure(point);
            if (!structure) {
              setRadialMenu(null);
              return;
            }
            if (structure.id !== draftId) onSelectStructure?.(structure.id);
            const position = shellPixels(event);
            setHover(null);
            setRadialMenu({ structureId: structure.id, x: position.x, y: position.y });
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || disabled) return;
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture?.(event.pointerId);
            pointerActive.current = true;
            setHover(null);
            const point = canvasPoint(event);
            setRadialMenu(null);
            if (activeSelection) {
              const hit = transformMode === "move" ? hitSelectionHandle(activeSelection.geometry, point, zoom) : null;
              if (hit) {
                beginTransform(activeSelection, "resize", point, hit);
                event.currentTarget.style.cursor = cursorForHandle(hit);
                return;
              }
              if (pointInSelectionFrame(activeSelection.geometry, point, zoom)) {
                beginTransform(activeSelection, transformMode, point);
                event.currentTarget.style.cursor = "grabbing";
                return;
              }
            }
            const picked = pickedStructure(point);
            if (picked) {
              beginTransform(picked, transformMode, point);
              event.currentTarget.style.cursor = "grabbing";
              return;
            }
            const nextPan = { x: event.clientX, y: event.clientY, camera, moved: false };
            panRef.current = nextPan;
            setPan(nextPan);
            event.currentTarget.style.cursor = "grabbing";
          }}
          onPointerMove={(event) => {
            if (disabled) return;
            const point = canvasPoint(event);
            const activeTransform = transformRef.current;
            if (pointerActive.current && activeTransform) {
              if (Math.hypot(point.x - activeTransform.from.x, point.y - activeTransform.from.y) * scale * zoom < dragThreshold && !activeTransform.moved) return;
              let nextGeometry: Point[];
              if (activeTransform.action === "move") {
                let dx = point.x - activeTransform.from.x;
                let dy = point.y - activeTransform.from.y;
                if (event.shiftKey) {
                  if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
                  else dx = 0;
                }
                nextGeometry = moveGeometry(activeTransform.originalGeometry, dx, dy);
              } else if (activeTransform.action === "resize") {
                const anchor = activeTransform.anchor!;
                const initialDistance = Math.max(activeTransform.startValue ?? 0, 0.001);
                const nextDistance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
                nextGeometry = scaleGeometry(activeTransform.originalGeometry, Math.max(0.08, nextDistance / initialDistance), anchor);
              } else {
                const center = activeTransform.anchor!;
                const startAngle = activeTransform.startValue ?? 0;
                const nextAngle = Math.atan2(point.y - center.y, point.x - center.x);
                let degrees = (nextAngle - startAngle) * 180 / Math.PI;
                if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
                nextGeometry = rotateGeometry(activeTransform.originalGeometry, degrees);
              }
              const nextTransform = { ...activeTransform, currentGeometry: nextGeometry, moved: true };
              updateTransform(nextTransform);
              if (activeTransform.draft) onTransformDraft?.(nextGeometry, activeTransform.action);
              return;
            }
            if (pointerActive.current && (panRef.current ?? pan)) {
              const activePan = panRef.current ?? pan!;
              const dx = event.clientX - activePan.x;
              const dy = event.clientY - activePan.y;
              if (Math.hypot(dx, dy) < dragThreshold && !activePan.moved) return;
              setCamera({ x: activePan.camera.x + dx, y: activePan.camera.y + dy });
              if (!activePan.moved) {
                const nextPan = { ...activePan, moved: true };
                panRef.current = nextPan;
                setPan(nextPan);
              }
              return;
            }
            if (activeSelection) {
              const hit = transformMode === "move" ? hitSelectionHandle(activeSelection.geometry, point, zoom) : null;
              if (hit) {
                event.currentTarget.style.cursor = cursorForHandle(hit);
                setHover(null);
                return;
              }
              if (pointInSelectionFrame(activeSelection.geometry, point, zoom)) {
                event.currentTarget.style.cursor = transformMode === "rotate" ? "crosshair" : "move";
                setHover(null);
                return;
              }
            }
            const picked = pickedStructure(point);
            event.currentTarget.style.cursor = picked ? transformMode === "rotate" ? "crosshair" : "move" : "grab";
            if (!picked) {
              setHover(null);
              return;
            }
            const px = shellPixels(event);
            setHover({ structure: picked, canvasX: px.x, canvasY: px.y });
          }}
          onPointerUp={(event) => {
            if (disabled) return;
            const activeTransform = transformRef.current;
            const activePan = panRef.current ?? pan;
            if (activeTransform?.moved) {
              if (activeTransform.draft) {
                onTransformDraft?.(activeTransform.currentGeometry, activeTransform.action);
                onTransformDraftEnd?.(activeTransform.originalGeometry, activeTransform.currentGeometry, activeTransform.action);
              } else {
                onTransformStructure?.(activeTransform.id, activeTransform.currentGeometry, activeTransform.action);
              }
            } else if (activePan && !activePan.moved && transformMode === "move") {
              onMoveDraft?.(canvasPoint(event));
            }
            clearPointerAction();
            event.currentTarget.style.cursor = disabled ? "not-allowed" : "grab";
          }}
          onPointerCancel={(event) => {
            cancelPointerAction();
            setHover(null);
            event.currentTarget.style.cursor = disabled ? "not-allowed" : "grab";
          }}
          onPointerLeave={() => {
            if (!pointerActive.current) setHover(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setRadialMenu(null);
            if (pointerActive.current) cancelPointerAction();
            event.currentTarget.style.cursor = disabled ? "not-allowed" : "grab";
          }}
        />
      </div>
      {radialMenu && radialTarget && <TransformRadialMenu
        x={radialMenu.x}
        y={radialMenu.y}
        label={radialTarget.id === draftId ? "Draft structure" : radialTarget.kind}
        mode={transformMode}
        onModeChange={changeTransformMode}
        onClose={() => {
          setRadialMenu(null);
          ref.current?.focus({ preventScroll: true });
        }}
      />}
      <div
        id="map-editor-transform-help"
        className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex max-w-[calc(100%_-_2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-[11px] text-[var(--muted)] shadow-xl lg:max-w-[calc(100%_-_420px)]"
        role="status"
        aria-live="polite"
      >
        <strong className="font-semibold text-[var(--paper)]">{transformMode === "move" ? "Move mode" : "Rotate mode"}</strong>
        <span aria-hidden="true">·</span>
        <span className="hidden md:inline">{transform ? "Esc cancels drag" : transformMode === "rotate" ? "Drag around center · Shift snaps 15° · right-click to change mode" : "Drag to move · square handles resize · right-click to change mode"}</span>
      </div>
      {hover && !transform && !radialMenu && <StructureTooltip hover={hover} viewportSize={viewportSize} />}
    </div>
  );
}

function drawStructure(ctx: CanvasRenderingContext2D, structure: MapStructure, selected: boolean) {
  if (structure.geometry.length === 0) return;
  const isDraft = structure.id === draftId;
  const color = structure.kind === "terrain" ? "#d9ffb5" : structure.kind === "door" ? "#ffb887" : structure.kind === "window" ? "#ebc7ff" : structure.kind === "cover" ? "#ffa9a9" : "#be8cff";
  ctx.strokeStyle = isDraft ? "#ffb887" : selected ? "#f6effa" : color;
  ctx.lineWidth = selected ? 4 : structure.blocks_vision ? 4 : 2;
  ctx.setLineDash(isDraft ? [8, 5] : []);
  ctx.beginPath();
  structure.geometry.forEach((point, index) => {
    const canvasPoint = toCanvas(point);
    if (index === 0) ctx.moveTo(canvasPoint.x, canvasPoint.y);
    else ctx.lineTo(canvasPoint.x, canvasPoint.y);
  });
  if (structure.kind === "terrain" && structure.geometry.length > 2) {
    ctx.fillStyle = selected ? "rgba(217,255,181,0.28)" : "rgba(217,255,181,0.16)";
    ctx.fill();
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSelectionFrame(ctx: CanvasRenderingContext2D, geometry: Point[], zoom: number, mode: TransformMode) {
  if (geometry.length === 0) return;
  const frame = geometryFrame(geometry);
  const left = frame.minX * scale;
  const top = frame.minY * scale;
  const right = frame.maxX * scale;
  const bottom = frame.maxY * scale;
  const handleSize = 10 / zoom;

  ctx.strokeStyle = "#f6effa";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  if (mode !== "move") return;
  ctx.fillStyle = "#f6effa";
  for (const { point } of resizeHandles(frame)) {
    ctx.fillRect(point.x * scale - handleSize / 2, point.y * scale - handleSize / 2, handleSize, handleSize);
  }
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

function resizeHandles(frame: GeometryFrame) {
  return [
    { handle: "nw" as const, point: { x: frame.minX, y: frame.minY }, anchor: { x: frame.maxX, y: frame.maxY } },
    { handle: "ne" as const, point: { x: frame.maxX, y: frame.minY }, anchor: { x: frame.minX, y: frame.maxY } },
    { handle: "se" as const, point: { x: frame.maxX, y: frame.maxY }, anchor: { x: frame.minX, y: frame.minY } },
    { handle: "sw" as const, point: { x: frame.minX, y: frame.maxY }, anchor: { x: frame.maxX, y: frame.minY } },
  ];
}

function hitSelectionHandle(geometry: Point[], point: Point, zoom: number): HandleHit | null {
  if (geometry.length === 0) return null;
  const frame = geometryFrame(geometry);
  const radius = 12 / (scale * zoom);
  for (const handle of resizeHandles(frame)) {
    if (Math.hypot(point.x - handle.point.x, point.y - handle.point.y) <= radius) {
      const endpointIndex = geometry.length === 2
        ? geometry.findIndex((endpoint) => endpoint.x === handle.point.x && endpoint.y === handle.point.y)
        : -1;
      return {
        handle: handle.handle,
        anchor: endpointIndex === -1 ? handle.anchor : geometry[endpointIndex === 0 ? 1 : 0],
      };
    }
  }
  return null;
}

function pointInSelectionFrame(geometry: Point[], point: Point, zoom: number) {
  if (geometry.length === 0) return false;
  const frame = geometryFrame(geometry);
  const padding = 10 / (scale * zoom);
  return point.x >= frame.minX - padding
    && point.x <= frame.maxX + padding
    && point.y >= frame.minY - padding
    && point.y <= frame.maxY + padding;
}

function cursorForHandle(hit: HandleHit) {
  return hit.handle === "nw" || hit.handle === "se" ? "nwse-resize" : "nesw-resize";
}

function pickStructure(structures: MapStructure[], point: Point) {
  const tolerance = 0.35;
  return structures.find((structure) => distanceToGeometry(point, structure.geometry) <= tolerance) ?? null;
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
      <p className="font-semibold capitalize tracking-[-0.01em] text-[var(--ink)]">{structure.id === draftId ? "Draft" : structure.kind}</p>
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
