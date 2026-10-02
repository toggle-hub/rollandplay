import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { MapStructure, ResolvedTokenAttack, RoomToken, VisibleRoomState } from "../api/types";
import { attackTargetStatus, type AttackTargetStatus } from "../lib/attacks";
import { geometryCenter, rotateGeometry, type Point } from "../lib/geometryTransforms";
import { structureLabel, templateGeometry } from "../lib/structures";
import { TokenAttackMenu } from "./TokenAttackMenu";
import { TransformRadialMenu, type TransformMode } from "./TransformRadialMenu";

export type MapSelection = { kind: "token" | "structure"; id: string };
type Props = {
  state: VisibleRoomState;
  selectedTokenId?: string;
  selectedStructureId?: string;
  movableTokenIds?: ReadonlySet<string>;
  canMoveStructures?: boolean;
  rulerDistanceMeters?: number;
  onMoveToken?: (tokenId: string, to: Point, path: Point[]) => void;
  onMoveStructure?: (structureId: string, geometry: Point[]) => void;
  onMeasure?: (from: Point, to: Point) => void;
  onSelect?: (selection: MapSelection | null) => void;
  onAttack?: (sourceTokenId: string, targetTokenId: string, attackId: string) => void;
  onEditAttacks?: (tokenId: string) => void;
  placingStructure?: { kind: string } | null;
  onPlaceStructure?: (geometry: Point[]) => void;
  onCancelPlacement?: () => void;
};
const n = (v: number | string | undefined, fallback = 0) =>
  typeof v === "number" ? v : v ? Number(v) : fallback;
const tokenCenter = (token: RoomToken): Point => ({ x: n(token.x_m), y: n(token.y_m) });
const attackStatusColors: Record<AttackTargetStatus, string> = {
  valid: "#d9ffb5",
  blocked: "#ffa9a9",
  out_of_range: "#80738e",
};

export function MapCanvas({
  state,
  selectedTokenId,
  selectedStructureId,
  movableTokenIds,
  canMoveStructures = false,
  rulerDistanceMeters,
  onMoveToken,
  onMoveStructure,
  onMeasure,
  onSelect,
  onAttack,
  onEditAttacks,
  placingStructure,
  onPlaceStructure,
  onCancelPlacement,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pointerActive = useRef(false);
  const rightGesture = useRef<{ from: Point; clientX: number; clientY: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{
    token: RoomToken;
    from: Point;
    current: Point;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [structureDrag, setStructureDrag] = useState<
    | { action: "move"; structure: MapStructure; from: Point; currentGeometry: Point[] }
    | { action: "rotate"; structure: MapStructure; center: Point; startAngle: number | null; currentGeometry: Point[] }
    | null
  >(null);
  const [ruler, setRuler] = useState<{ from: Point; to: Point } | null>(null);
  const [radialMenu, setRadialMenu] = useState<{ structureId: string; x: number; y: number } | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>("move");
  const [attackMenu, setAttackMenu] = useState<{ tokenId: string; x: number; y: number } | null>(null);
  const [rangePreview, setRangePreview] = useState<{ tokenId: string; rangeM: number } | null>(null);
  const [targeting, setTargeting] = useState<{ tokenId: string; attackId: string; hoverTokenId?: string; message?: string } | null>(null);
  const [placementPoint, setPlacementPoint] = useState<Point | null>(null);
  const placingKind = placingStructure?.kind;
  const findToken = (tokenId?: string) => tokenId === undefined ? undefined : state.visibleTokens.find((token) => token.id === tokenId);
  const targetingSource = findToken(targeting?.tokenId);
  const targetingAttack = targetingSource?.attacks?.find((attack) => attack.id === targeting?.attackId);
  const attackMenuToken = findToken(attackMenu?.tokenId);
  const previewToken = findToken(rangePreview?.tokenId);
  const scale = 24;
  const active = state.activeMap;
  const gridSize = n(active?.grid_size_m, n(state.metersPerGrid, 1));
  const toCanvas = (p: Point) => ({ x: p.x * scale, y: p.y * scale });
  const fromCanvas = (x: number, y: number) => ({ x: x / scale, y: y / scale });
  const eventPoint = (event: Pick<PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>, "currentTarget" | "clientX" | "clientY">) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return fromCanvas(
      (event.clientX - rect.left) * (canvas.width / rect.width),
      (event.clientY - rect.top) * (canvas.height / rect.height),
    );
  };
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const w = n(active?.width_m, 30) * scale;
    const h = n(active?.height_m, 30) * scale;
    c.width = w;
    c.height = h;
    ctx.fillStyle = "#221c2b";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#40364c";
    ctx.lineWidth = 1;
    const grid = n(state.metersPerGrid, 1) * scale;
    for (let x = 0; x <= w; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    drawStructures(ctx, state.structures, scale, selectedStructureId, structureDrag);
    if (state.visibility?.fogPolygon?.length) {
      ctx.fillStyle = "rgba(20,16,25,.45)";
      ctx.beginPath();
      state.visibility.fogPolygon.forEach((p, i) => {
        const q = toCanvas(p);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fill("evenodd");
    }
    state.visibleTokens.forEach((t) =>
      drawToken(ctx, t, scale, t.id === selectedTokenId),
    );
    if (placingKind && placementPoint) {
      ctx.strokeStyle = "#be8cff";
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      templateGeometry(placingKind, placementPoint, gridSize).forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x * scale, point.y * scale);
        else ctx.lineTo(point.x * scale, point.y * scale);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const rangeSource = targetingAttack ? targetingSource : previewToken;
    const rangeM = targetingAttack?.range_m ?? rangePreview?.rangeM;
    if (rangeSource && rangeM !== undefined) {
      const center = toCanvas(tokenCenter(rangeSource));
      ctx.fillStyle = "rgba(255,184,135,.08)";
      ctx.strokeStyle = "#ffb887";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(center.x, center.y, rangeM * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (targeting && targetingSource && targetingAttack) {
      const from = tokenCenter(targetingSource);
      state.visibleTokens.forEach((token) => {
        if (token.id === targetingSource.id) return;
        const to = tokenCenter(token);
        const status = attackTargetStatus(from, to, targetingAttack.range_m, state.structures);
        const center = toCanvas(to);
        ctx.strokeStyle = attackStatusColors[status];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(center.x, center.y, (n(token.size_m, 1) * scale) / 2 + 4, 0, Math.PI * 2);
        ctx.stroke();
        if (token.id !== targeting.hoverTokenId) return;
        const a = toCanvas(from);
        ctx.setLineDash(status === "valid" ? [] : [5, 5]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(center.x, center.y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }
    if (drag) {
      const a = toCanvas(drag.from),
        b = toCanvas(drag.current);
      ctx.strokeStyle = "#ffb887";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (ruler) {
      const a = toCanvas(ruler.from),
        b = toCanvas(ruler.to);
      ctx.strokeStyle = "#d9ffb5";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (rulerDistanceMeters !== undefined) {
        ctx.fillStyle = "#f6effa";
        ctx.fillText(`${rulerDistanceMeters.toFixed(2)} m`, b.x + 8, b.y - 8);
      }
    }
  }, [state, selectedTokenId, selectedStructureId, canMoveStructures, rulerDistanceMeters, drag, structureDrag, ruler, rangePreview, targeting, placingKind, placementPoint, gridSize]);
  useEffect(() => {
    if (!placingKind) {
      setPlacementPoint(null);
      return;
    }
    setTargeting(null);
    closeAttackMenu();
  }, [placingKind]);
  useEffect(() => {
    if (targeting && !targetingAttack) setTargeting(null);
    if (attackMenu && !attackMenuToken) setAttackMenu(null);
    if (rangePreview && !previewToken) setRangePreview(null);
  }, [targeting, targetingAttack, attackMenu, attackMenuToken, rangePreview, previewToken]);
  function pickToken(point: Point, accept: (token: RoomToken) => boolean) {
    for (let index = state.visibleTokens.length - 1; index >= 0; index--) {
      const token = state.visibleTokens[index];
      if (accept(token) && Math.hypot(n(token.x_m) - point.x, n(token.y_m) - point.y) <= n(token.size_m, 1)) return token;
    }
  }
  function closeAttackMenu() {
    setAttackMenu(null);
    setRangePreview(null);
  }
  function chooseAttack(attack: ResolvedTokenAttack) {
    if (!attackMenu) return;
    setTargeting({ tokenId: attackMenu.tokenId, attackId: attack.id });
    closeAttackMenu();
    ref.current?.focus({ preventScroll: true });
  }
  function cancelTargeting() {
    setTargeting(null);
    ref.current?.focus({ preventScroll: true });
  }
  function stopPlacing() {
    onCancelPlacement?.();
    ref.current?.focus({ preventScroll: true });
  }
  function pickMovableStructure(point: Point) {
    if (!canMoveStructures) return;
    for (let index = state.structures.length - 1; index >= 0; index--) {
      const structure = state.structures[index];
      if (hitsStructure(structure, point)) return structure;
    }
  }
  const radialStructure = radialMenu
    ? state.structures.find((structure) => structure.id === radialMenu.structureId)
    : undefined;
  function changeTransformMode(mode: TransformMode) {
    setTransformMode(mode);
    setRadialMenu(null);
    ref.current?.focus({ preventScroll: true });
  }
  function openStructureWheel(event: MouseEvent<HTMLCanvasElement> | PointerEvent<HTMLCanvasElement>) {
    const structure = pickMovableStructure(eventPoint(event));
    if (!structure) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSelect?.({ kind: "structure", id: structure.id });
    setRadialMenu({
      structureId: structure.id,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }
  function cancelPointerAction() {
    rightGesture.current = null;
    pointerActive.current = false;
    setDrag(null);
    setStructureDrag(null);
    setRuler(null);
  }
  function finishRightGesture(event: MouseEvent<HTMLCanvasElement> | PointerEvent<HTMLCanvasElement>) {
    const gesture = rightGesture.current;
    if (!gesture) return;
    cancelPointerAction();
    event.currentTarget.style.cursor = "default";
    if (!gesture.moved) openStructureWheel(event);
  }
  useEffect(() => {
    window.addEventListener("blur", cancelPointerAction);
    return () => window.removeEventListener("blur", cancelPointerAction);
  }, []);
  return (
    <div className="relative min-w-0">
      <canvas
        ref={ref}
        className="block h-auto w-full max-w-full touch-none rounded-xl border border-[var(--paper)]/15 bg-[var(--surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        role="img"
        tabIndex={0}
        aria-label="Interactive tabletop map. Right-click a structure to choose persistent Move or Rotate mode. Drag structures in the chosen mode; hold Shift to snap rotation to 15 degrees. Drag tokens to move them. Click a token you control without dragging to choose an attack, then click a target. Hold the right mouse button and drag to measure distance; release to hide the ruler. While placing a structure, click the map to place it; press Escape to stop."
        onContextMenu={(event) => {
          event.preventDefault();
          // Mouse contextmenu fires on press on some platforms and on release on
          // others. Right-button clicks are resolved on release, after drag detection.
          if (event.button === 2 || rightGesture.current) return;
          setRadialMenu(null);
          openStructureWheel(event);
        }}
        onPointerDown={(event) => {
          if ((event.button !== 0 && event.button !== 2) || pointerActive.current) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pointerActive.current = true;
          setRadialMenu(null);
          closeAttackMenu();
          const point = eventPoint(event);
          setRuler(null);
          if (event.button === 2) {
            rightGesture.current = { from: point, clientX: event.clientX, clientY: event.clientY, moved: false };
            return;
          }
          if (placingKind) {
            onPlaceStructure?.(templateGeometry(placingKind, point, gridSize));
            return;
          }
          if (targeting) {
            const target = targetingSource && targetingAttack
              ? pickToken(point, (candidate) => candidate.id !== targetingSource.id)
              : undefined;
            if (!target || !targetingSource || !targetingAttack) {
              setTargeting(null);
              return;
            }
            const status = attackTargetStatus(tokenCenter(targetingSource), tokenCenter(target), targetingAttack.range_m, state.structures);
            if (status === "valid") {
              onAttack?.(targetingSource.id, target.id, targetingAttack.id);
              setTargeting(null);
            } else {
              setTargeting({ ...targeting, message: status === "blocked" ? "Blocked by a structure" : "Out of range" });
            }
            return;
          }
          const token = pickToken(point, (candidate) => movableTokenIds?.has(candidate.id) ?? true);
          if (token) {
            setDrag({ token, from: tokenCenter(token), current: point, clientX: event.clientX, clientY: event.clientY });
            onSelect?.({ kind: "token", id: token.id });
            return;
          }
          const structure = pickMovableStructure(point);
          if (structure) {
            if (transformMode === "move") {
              setStructureDrag({ action: "move", structure, from: point, currentGeometry: structure.geometry });
            } else {
              const center = geometryCenter(structure.geometry);
              setStructureDrag({
                action: "rotate",
                structure,
                center,
                startAngle: Math.hypot(point.x - center.x, point.y - center.y) > 6 / scale
                  ? Math.atan2(point.y - center.y, point.x - center.x)
                  : null,
                currentGeometry: structure.geometry,
              });
            }
            event.currentTarget.style.cursor = transformMode === "rotate" ? "crosshair" : "grabbing";
            onSelect?.({ kind: "structure", id: structure.id });
            return;
          }
          onSelect?.(null);
        }}
        onPointerMove={(event) => {
          const point = eventPoint(event);
          const gesture = rightGesture.current;
          if (gesture) {
            if (!(event.buttons & 2)) {
              cancelPointerAction();
              return;
            }
            if (!gesture.moved && Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 4) return;
            gesture.moved = true;
            setRuler({ from: gesture.from, to: point });
            event.currentTarget.style.cursor = "crosshair";
            onMeasure?.(gesture.from, point);
            return;
          }
          if (!pointerActive.current) {
            if (placingKind) {
              setPlacementPoint(point);
              event.currentTarget.style.cursor = "crosshair";
              return;
            }
            if (targeting && targetingSource) {
              const hover = pickToken(point, (candidate) => candidate.id !== targetingSource.id);
              if (hover?.id !== targeting.hoverTokenId) setTargeting({ ...targeting, hoverTokenId: hover?.id });
              event.currentTarget.style.cursor = hover ? "crosshair" : "default";
              return;
            }
            event.currentTarget.style.cursor = pickToken(point, (candidate) => movableTokenIds?.has(candidate.id) ?? true)
              ? "move"
              : pickMovableStructure(point) ? (transformMode === "rotate" ? "crosshair" : "move") : "default";
            return;
          }
          if (drag) {
            setDrag({ ...drag, current: point });
            return;
          }
          if (structureDrag) {
            if (!canMoveStructures) return;
            if (structureDrag.action === "move") {
              const dx = point.x - structureDrag.from.x;
              const dy = point.y - structureDrag.from.y;
              setStructureDrag({
                ...structureDrag,
                currentGeometry: structureDrag.structure.geometry.map((item) => ({ x: round(item.x + dx), y: round(item.y + dy) })),
              });
            } else {
              if (Math.hypot(point.x - structureDrag.center.x, point.y - structureDrag.center.y) <= 6 / scale) return;
              const angle = Math.atan2(point.y - structureDrag.center.y, point.x - structureDrag.center.x);
              if (structureDrag.startAngle === null) {
                setStructureDrag({ ...structureDrag, startAngle: angle });
                return;
              }
              let degrees = (angle - structureDrag.startAngle) * 180 / Math.PI;
              if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
              setStructureDrag({
                ...structureDrag,
                currentGeometry: rotateGeometry(structureDrag.structure.geometry, degrees, structureDrag.center),
              });
            }
            return;
          }
        }}
        onPointerUp={(event) => {
          if (event.button === 2) {
            finishRightGesture(event);
            return;
          }
          if (!pointerActive.current) return;
          if (drag) {
            if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 4) {
              const to = eventPoint(event);
              onMoveToken?.(drag.token.id, to, [drag.from, to]);
            } else if (onAttack) {
              const rect = event.currentTarget.getBoundingClientRect();
              const firstAttack = drag.token.attacks?.[0];
              setAttackMenu({ tokenId: drag.token.id, x: event.clientX - rect.left, y: event.clientY - rect.top });
              setRangePreview(firstAttack ? { tokenId: drag.token.id, rangeM: firstAttack.range_m } : null);
            }
          } else if (canMoveStructures && structureDrag && !sameGeometry(structureDrag.structure.geometry, structureDrag.currentGeometry)) {
            onMoveStructure?.(structureDrag.structure.id, structureDrag.currentGeometry);
          }
          pointerActive.current = false;
          setDrag(null);
          setStructureDrag(null);
          event.currentTarget.style.cursor = placingKind || (transformMode === "rotate" && canMoveStructures) ? "crosshair" : "default";
        }}
        onPointerCancel={(event) => {
          cancelPointerAction();
          event.currentTarget.style.cursor = transformMode === "rotate" && canMoveStructures ? "crosshair" : "default";
        }}
        onMouseUp={(event) => {
          // pointerup waits for the last held mouse button; mouseup does not.
          if (event.button === 2) finishRightGesture(event);
        }}
        onLostPointerCapture={cancelPointerAction}
        onBlur={cancelPointerAction}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          if (placingKind) onCancelPlacement?.();
          setRadialMenu(null);
          closeAttackMenu();
          setTargeting(null);
          cancelPointerAction();
        }}
      />
      {radialMenu && radialStructure && <TransformRadialMenu
        x={radialMenu.x}
        y={radialMenu.y}
        label={radialStructure.kind}
        mode={transformMode}
        onModeChange={changeTransformMode}
        onClose={() => {
          setRadialMenu(null);
          ref.current?.focus({ preventScroll: true });
        }}
      />}
      {attackMenu && attackMenuToken && <TokenAttackMenu
        x={attackMenu.x}
        y={attackMenu.y}
        token={attackMenuToken}
        onPreview={(attack) => setRangePreview({ tokenId: attackMenuToken.id, rangeM: attack.range_m })}
        onChoose={chooseAttack}
        onEdit={attackMenuToken.attacks_editable && onEditAttacks ? () => {
          onEditAttacks(attackMenuToken.id);
          closeAttackMenu();
        } : undefined}
        onClose={() => {
          closeAttackMenu();
          ref.current?.focus({ preventScroll: true });
        }}
      />}
      {placingKind ? <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-xs text-[var(--paper)] shadow-xl" role="status" aria-live="polite">
        <span>{`Placing ${structureLabel(placingKind)} — click the map to place it`}</span>
        <button className="shrink-0 text-[var(--accent)] underline underline-offset-4 hover:text-[var(--paper)]" type="button" onClick={stopPlacing}>Stop placing</button>
      </div> : targeting && targetingAttack && <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-xs text-[var(--paper)] shadow-xl" role="status" aria-live="polite">
        <span>{`${targetingAttack.name} · ${targetingAttack.range_m} m — click a highlighted target`}{targeting.message && ` · ${targeting.message}`}</span>
        <button className="shrink-0 text-[var(--accent)] underline underline-offset-4 hover:text-[var(--paper)]" type="button" onClick={cancelTargeting}>Cancel attack</button>
      </div>}
      {canMoveStructures && <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-xs text-[var(--paper)] shadow-xl" role="status" aria-live="polite">
        {transformMode === "move" ? "Move mode" : "Rotate mode"} · Drag a structure
      </div>}
    </div>
  );
}
function drawStructures(
  ctx: CanvasRenderingContext2D,
  structures: MapStructure[],
  scale: number,
  selectedStructureId?: string,
  drag?: { structure: MapStructure; currentGeometry: Point[] } | null,
) {
  structures.forEach((structure) => {
    const selected = structure.id === selectedStructureId;
    const geometry = drag?.structure.id === structure.id ? drag.currentGeometry : structure.geometry;
    ctx.strokeStyle = structure.is_hidden ? "#80738e" : selected ? "#f6effa" : structure.blocks_movement ? "#be8cff" : "#ebc7ff";
    ctx.lineWidth = selected ? 4 : structure.blocks_vision ? 4 : 2;
    ctx.setLineDash(structure.is_hidden ? [6, 5] : []);
    ctx.beginPath();
    geometry.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x * scale, point.y * scale);
      else ctx.lineTo(point.x * scale, point.y * scale);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  });
}
function drawToken(
  ctx: CanvasRenderingContext2D,
  t: RoomToken,
  scale: number,
  selected: boolean,
) {
  ctx.fillStyle = t.is_hidden ? "#80738e" : selected ? "#f6effa" : "#be8cff";
  ctx.beginPath();
  ctx.arc(
    n(t.x_m) * scale,
    n(t.y_m) * scale,
    (n(t.size_m, 1) * scale) / 2,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = t.is_hidden ? "#b8adc4" : "#f6effa";
  ctx.fillText(`${t.name}${t.is_hidden ? " (hidden)" : ""}`, n(t.x_m) * scale + 8, n(t.y_m) * scale);
}
function hitsStructure(structure: MapStructure, point: Point) {
  const geometry = structure.geometry;
  if (geometry.length > 2 && pointInPolygon(point, geometry)) return true;
  for (let index = 0; index < geometry.length - 1; index++) {
    if (pointToSegmentDistance(point, geometry[index], geometry[index + 1]) <= 0.35) return true;
  }
  return geometry.length > 2 && pointToSegmentDistance(point, geometry[geometry.length - 1], geometry[0]) <= 0.35;
}
function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const position = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + position * dx), point.y - (start.y + position * dy));
}
function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function sameGeometry(left: Point[], right: Point[]) {
  return left.length === right.length
    && left.every((point, index) => point.x === right[index].x && point.y === right[index].y);
}
function round(value: number) {
  return Math.round(value * 100) / 100;
}
