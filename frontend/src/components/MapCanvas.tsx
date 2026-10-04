import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { assetURL } from "../api/client";
import type { MapStructure, ResolvedTokenAttack, RoomToken, VisibleRoomState } from "../api/types";
import { attackTargetStatus, type AttackTargetStatus } from "../lib/attacks";
import { geometryCenter, rotateGeometry, type Point } from "../lib/geometryTransforms";
import { structureLabel, templateGeometry } from "../lib/structures";
import { clampTokenCenter, snapTokenCenter } from "../lib/tokenGrid";
import { castVision } from "../lib/vision";
import { TokenAttackMenu } from "./TokenAttackMenu";

export type MapSelection = { kind: "tokens"; ids: string[] } | { kind: "structure"; id: string };
type Props = {
  state: VisibleRoomState;
  selectedTokenIds?: readonly string[];
  selectedStructureId?: string;
  movableTokenIds?: ReadonlySet<string>;
  canMoveStructures?: boolean;
  rulerDistanceMeters?: number;
  onMoveToken?: (tokenId: string, to: Point, path: Point[]) => void;
  onMoveTokens?: (moves: { tokenId: string; to: Point }[]) => void;
  onMoveStructure?: (structureId: string, geometry: Point[]) => void;
  onMeasure?: (from: Point, to: Point) => void;
  onSelect?: (selection: MapSelection | null) => void;
  onAttack?: (sourceTokenId: string, targetTokenId: string, attackId: string) => void;
  onEditAttacks?: (tokenId: string) => void;
  placingStructure?: { kind: string } | null;
  onPlaceStructure?: (geometry: Point[]) => void;
  onCancelPlacement?: () => void;
  /** Where tokens dragged by someone else at the table are right now. */
  remoteDragPositions?: ReadonlyMap<string, Point>;
  /** Live positions of the tokens being dragged, before they are dropped. */
  onDragTokens?: (moves: { tokenId: string; to: Point }[]) => void;
  /** The live drag ended without a move: cancelled, or dropped where it started. */
  onDragTokensEnd?: () => void;
};
type TokenDrag = {
  /** Every token moving together; the grabbed one leads and snaps to the grid. */
  tokens: RoomToken[];
  grabbed: RoomToken;
  /** Pointer position relative to the grabbed token's center, so the token does not jump under the pointer. */
  grabOffset: Point;
  from: Point;
  current: Point;
  clientX: number;
  clientY: number;
  moved: boolean;
};
type Marquee = { from: Point; to: Point; clientX: number; clientY: number; moved: boolean };
type TransformFrame = { box: Point[]; anchor: Point; handle: Point; center: Point };
const n = (v: number | string | undefined, fallback = 0) =>
  typeof v === "number" ? v : v ? Number(v) : fallback;
const tokenCenter = (token: RoomToken): Point => ({ x: n(token.x_m), y: n(token.y_m) });
const attackStatusColors: Record<AttackTargetStatus, string> = {
  valid: "#d9ffb5",
  blocked: "#ffa9a9",
  out_of_range: "#80738e",
};
const framePaddingPx = 6;
const rotationHandleOffsetPx = 24;
const rotationHandleRadiusPx = 7;
const rotationHandleHitRadiusPx = 10;

export function MapCanvas({
  state,
  selectedTokenIds,
  selectedStructureId,
  movableTokenIds,
  canMoveStructures = false,
  rulerDistanceMeters,
  onMoveToken,
  onMoveTokens,
  onMoveStructure,
  onMeasure,
  onSelect,
  onAttack,
  onEditAttacks,
  placingStructure,
  onPlaceStructure,
  onCancelPlacement,
  remoteDragPositions,
  onDragTokens,
  onDragTokensEnd,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fogLayer = useRef<HTMLCanvasElement | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [imageVersion, setImageVersion] = useState(0);
  const pointerActive = useRef(false);
  const rightGesture = useRef<{ from: Point; clientX: number; clientY: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<TokenDrag | null>(null);
  // Whether the table has been sent live frames of the current drag that a move or end must close.
  const streaming = useRef(false);
  const dragEnd = useRef(onDragTokensEnd);
  useEffect(() => {
    dragEnd.current = onDragTokensEnd;
  });
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [structureDrag, setStructureDrag] = useState<
    | { action: "move"; structure: MapStructure; from: Point; currentGeometry: Point[] }
    | { action: "rotate"; structure: MapStructure; center: Point; startAngle: number; degrees: number; currentGeometry: Point[] }
    | null
  >(null);
  const [ruler, setRuler] = useState<{ from: Point; to: Point } | null>(null);
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
  const selectedStructure = canMoveStructures && selectedStructureId !== undefined
    ? state.structures.find((structure) => structure.id === selectedStructureId)
    : undefined;
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
  const mapWidth = n(active?.width_m, 30);
  const mapHeight = n(active?.height_m, 30);
  const isMovable = (token: RoomToken) => movableTokenIds?.has(token.id) ?? true;
  // Where each dragged token lands: the grabbed token snaps to the grid and the rest keep their offsets to it.
  function landingPositions(tokenDrag: TokenDrag, pointer: Point) {
    const target = snapTokenCenter(
      { x: pointer.x - tokenDrag.grabOffset.x, y: pointer.y - tokenDrag.grabOffset.y },
      n(tokenDrag.grabbed.size_m, 1),
      gridSize,
      mapWidth,
      mapHeight,
    );
    const dx = target.x - tokenDrag.from.x;
    const dy = target.y - tokenDrag.from.y;
    return new Map(tokenDrag.tokens.map((token) => [
      token.id,
      token.id === tokenDrag.grabbed.id
        ? target
        : clampTokenCenter({ x: n(token.x_m) + dx, y: n(token.y_m) + dy }, n(token.size_m, 1), mapWidth, mapHeight),
    ]));
  }
  // Where each dragged token is drawn mid-drag: the grabbed token stays under the pointer and the rest keep their offsets to it.
  function followPositions(tokenDrag: TokenDrag, pointer: Point) {
    const lead = clampTokenCenter(
      { x: pointer.x - tokenDrag.grabOffset.x, y: pointer.y - tokenDrag.grabOffset.y },
      n(tokenDrag.grabbed.size_m, 1),
      mapWidth,
      mapHeight,
    );
    const dx = lead.x - tokenDrag.from.x;
    const dy = lead.y - tokenDrag.from.y;
    return new Map(tokenDrag.tokens.map((token) => [
      token.id,
      token.id === tokenDrag.grabbed.id
        ? lead
        : clampTokenCenter({ x: n(token.x_m) + dx, y: n(token.y_m) + dy }, n(token.size_m, 1), mapWidth, mapHeight),
    ]));
  }
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const w = mapWidth * scale;
    const h = mapHeight * scale;
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
    // Tokens being dragged here or by someone else at the table are drawn, and see, from where they are now.
    const positions = drag?.moved ? followPositions(drag, drag.current) : undefined;
    const livePosition = (token: RoomToken) => positions?.get(token.id) ?? remoteDragPositions?.get(token.id) ?? tokenCenter(token);
    drawStructures(ctx, state.structures, scale, selectedStructureId, structureDrag);
    if (state.visibility?.fog) {
      // Cut every token's sight out of an opaque layer, then lay that layer over the map.
      const layer = fogLayer.current ??= document.createElement("canvas");
      layer.width = w;
      layer.height = h;
      const fog = layer.getContext("2d")!;
      fog.fillStyle = "rgba(12,10,16,.82)";
      fog.fillRect(0, 0, w, h);
      fog.globalCompositeOperation = "destination-out";
      fog.fillStyle = "#000";
      state.visibility.visionAreas.forEach(({ tokenId, origin, polygon }) => {
        // The server cast this area from origin; a token since dragged or dropped elsewhere is recast where it is.
        const token = findToken(tokenId);
        const at = token ? livePosition(token) : origin;
        const points = token && Math.hypot(at.x - origin.x, at.y - origin.y) > 1e-6
          ? castVision(at, n(token.vision_range_m), state.structures)
          : polygon;
        fog.beginPath();
        points.forEach((p, i) => {
          const q = toCanvas(p);
          if (i === 0) fog.moveTo(q.x, q.y);
          else fog.lineTo(q.x, q.y);
        });
        fog.closePath();
        fog.fill();
      });
      fog.globalCompositeOperation = "source-over";
      ctx.drawImage(layer, 0, 0);
    }
    if (drag?.moved) {
      // Dashed outlines mark where the dragged tokens started.
      ctx.strokeStyle = "#80738e";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      drag.tokens.forEach((token) => {
        const center = toCanvas(tokenCenter(token));
        ctx.beginPath();
        ctx.arc(center.x, center.y, (n(token.size_m, 1) * scale) / 2, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      // Dashed lavender ghosts mark the cells the dragged tokens snap to when dropped.
      const landing = landingPositions(drag, drag.current);
      ctx.strokeStyle = "#be8cff";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      drag.tokens.forEach((token) => {
        const center = toCanvas(landing.get(token.id)!);
        ctx.beginPath();
        ctx.arc(center.x, center.y, (n(token.size_m, 1) * scale) / 2, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    }
    state.visibleTokens.forEach((t) => {
      const image = t.image_asset_id ? images.current.get(t.image_asset_id) : undefined;
      drawToken(ctx, t, livePosition(t), scale, !!selectedTokenIds?.includes(t.id), image);
    });
    const framed = canMoveStructures ? structureDrag?.structure ?? selectedStructure : undefined;
    if (framed) {
      const frame = structureDrag?.action === "rotate"
        ? rotateFrame(structureFrame(structureDrag.structure.geometry, scale), structureDrag.degrees)
        : structureFrame(structureDrag?.currentGeometry ?? framed.geometry, scale);
      drawTransformFrame(ctx, frame, scale);
    }
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
    if (marquee?.moved) {
      const a = toCanvas(marquee.from),
        b = toCanvas(marquee.to);
      ctx.fillStyle = "rgba(190,140,255,.12)";
      ctx.strokeStyle = "#be8cff";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.fill();
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
  }, [state, selectedTokenIds, selectedStructureId, canMoveStructures, rulerDistanceMeters, drag, remoteDragPositions, marquee, structureDrag, ruler, rangePreview, targeting, placingKind, placementPoint, gridSize, imageVersion]);
  useEffect(() => {
    state.visibleTokens.forEach((token) => {
      const id = token.image_asset_id;
      if (!id || images.current.has(id)) return;
      const image = new Image();
      image.onload = () => setImageVersion((version) => version + 1);
      image.src = assetURL(id);
      images.current.set(id, image);
    });
  }, [state.visibleTokens]);
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
  function hitsRotationHandle(point: Point) {
    if (!selectedStructure) return false;
    const { handle } = structureFrame(selectedStructure.geometry, scale);
    return Math.hypot(point.x - handle.x, point.y - handle.y) <= rotationHandleHitRadiusPx / scale;
  }
  function endStreaming() {
    if (!streaming.current) return;
    streaming.current = false;
    dragEnd.current?.();
  }
  function cancelPointerAction() {
    endStreaming();
    rightGesture.current = null;
    pointerActive.current = false;
    setDrag(null);
    setMarquee(null);
    setStructureDrag(null);
    setRuler(null);
  }
  function finishRightGesture(event: MouseEvent<HTMLCanvasElement> | PointerEvent<HTMLCanvasElement>) {
    if (!rightGesture.current) return;
    cancelPointerAction();
    event.currentTarget.style.cursor = "default";
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
        aria-label="Interactive tabletop map. Drag a structure to move it. Drag the round handle above the selected structure to rotate it; hold Shift to snap rotation to 15 degrees. Drag a token to move it; it snaps to the grid when dropped, and everyone at the table sees it move. Drag across empty space to select several tokens, then drag one of them to move the group. Click a token you control without dragging to choose an attack, then click a target. Hold the right mouse button and drag to measure distance; release to hide the ruler. Press Escape to cancel a drag. While placing a structure, click the map to place it; press Escape to stop."
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if ((event.button !== 0 && event.button !== 2) || pointerActive.current) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pointerActive.current = true;
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
          if (selectedStructure && hitsRotationHandle(point)) {
            const center = geometryCenter(selectedStructure.geometry);
            setStructureDrag({
              action: "rotate",
              structure: selectedStructure,
              center,
              startAngle: Math.atan2(point.y - center.y, point.x - center.x),
              degrees: 0,
              currentGeometry: selectedStructure.geometry,
            });
            event.currentTarget.style.cursor = "grabbing";
            return;
          }
          const token = pickToken(point, isMovable);
          if (token) {
            // Grabbing one token of a multi-token selection drags the whole selection.
            const group = selectedTokenIds && selectedTokenIds.length > 1 && selectedTokenIds.includes(token.id) ? selectedTokenIds : undefined;
            const tokens = group
              ? state.visibleTokens.filter((candidate) => group.includes(candidate.id) && isMovable(candidate))
              : [token];
            const from = tokenCenter(token);
            setDrag({
              tokens,
              grabbed: token,
              grabOffset: { x: point.x - from.x, y: point.y - from.y },
              from,
              current: point,
              clientX: event.clientX,
              clientY: event.clientY,
              moved: false,
            });
            if (!group) onSelect?.({ kind: "tokens", ids: [token.id] });
            return;
          }
          const structure = pickMovableStructure(point);
          if (structure) {
            setStructureDrag({ action: "move", structure, from: point, currentGeometry: structure.geometry });
            event.currentTarget.style.cursor = "grabbing";
            onSelect?.({ kind: "structure", id: structure.id });
            return;
          }
          setMarquee({ from: point, to: point, clientX: event.clientX, clientY: event.clientY, moved: false });
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
            event.currentTarget.style.cursor = hitsRotationHandle(point)
              ? "grab"
              : pickToken(point, isMovable) || pickMovableStructure(point)
                ? "move"
                : "default";
            return;
          }
          if (drag) {
            const next = { ...drag, current: point, moved: drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 4 };
            setDrag(next);
            if (next.moved && onDragTokens) {
              const follow = followPositions(next, point);
              streaming.current = true;
              onDragTokens(next.tokens.map((token) => ({ tokenId: token.id, to: follow.get(token.id)! })));
            }
            return;
          }
          if (marquee) {
            setMarquee({ ...marquee, to: point, moved: marquee.moved || Math.hypot(event.clientX - marquee.clientX, event.clientY - marquee.clientY) >= 4 });
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
              let degrees = (angle - structureDrag.startAngle) * 180 / Math.PI;
              if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
              setStructureDrag({
                ...structureDrag,
                degrees,
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
            let moving = false;
            if (drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 4) {
              const positions = landingPositions(drag, eventPoint(event));
              const to = positions.get(drag.grabbed.id)!;
              if (to.x !== drag.from.x || to.y !== drag.from.y) {
                if (drag.tokens.length === 1 && onMoveToken) {
                  onMoveToken(drag.grabbed.id, to, [drag.from, to]);
                  moving = true;
                } else if (drag.tokens.length > 1 && onMoveTokens) {
                  onMoveTokens(drag.tokens.map((token) => ({ tokenId: token.id, to: positions.get(token.id)! })));
                  moving = true;
                }
              }
            } else {
              // A click on one token of a group selects just that token.
              if (drag.tokens.length > 1) onSelect?.({ kind: "tokens", ids: [drag.grabbed.id] });
              if (onAttack) {
                const rect = event.currentTarget.getBoundingClientRect();
                const firstAttack = drag.grabbed.attacks?.[0];
                setAttackMenu({ tokenId: drag.grabbed.id, x: event.clientX - rect.left, y: event.clientY - rect.top });
                setRangePreview(firstAttack ? { tokenId: drag.grabbed.id, rangeM: firstAttack.range_m } : null);
              }
            }
            // The move itself closes the live drag for the table; anything else ends it here.
            if (moving) streaming.current = false;
            else endStreaming();
          } else if (marquee) {
            if (marquee.moved || Math.hypot(event.clientX - marquee.clientX, event.clientY - marquee.clientY) >= 4) {
              const to = eventPoint(event);
              const left = Math.min(marquee.from.x, to.x), right = Math.max(marquee.from.x, to.x);
              const top = Math.min(marquee.from.y, to.y), bottom = Math.max(marquee.from.y, to.y);
              const ids = state.visibleTokens
                .filter((token) => {
                  const center = tokenCenter(token);
                  return isMovable(token) && center.x >= left && center.x <= right && center.y >= top && center.y <= bottom;
                })
                .map((token) => token.id);
              onSelect?.(ids.length ? { kind: "tokens", ids } : null);
            } else {
              onSelect?.(null);
            }
          } else if (canMoveStructures && structureDrag && !sameGeometry(structureDrag.structure.geometry, structureDrag.currentGeometry)) {
            onMoveStructure?.(structureDrag.structure.id, structureDrag.currentGeometry);
          }
          pointerActive.current = false;
          setDrag(null);
          setMarquee(null);
          setStructureDrag(null);
          event.currentTarget.style.cursor = placingKind ? "crosshair" : "default";
        }}
        onPointerCancel={(event) => {
          cancelPointerAction();
          event.currentTarget.style.cursor = "default";
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
          closeAttackMenu();
          setTargeting(null);
          cancelPointerAction();
        }}
      />
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
// Axis-aligned, padded bounding box with a rotation handle above its top edge,
// or below the bottom edge when the structure hugs the top of the map.
function structureFrame(geometry: Point[], scale: number): TransformFrame {
  const xs = geometry.map((point) => point.x);
  const ys = geometry.map((point) => point.y);
  const padding = framePaddingPx / scale;
  const left = Math.min(...xs) - padding;
  const right = Math.max(...xs) + padding;
  const top = Math.min(...ys) - padding;
  const bottom = Math.max(...ys) + padding;
  const handleAbove = top * scale - rotationHandleOffsetPx >= rotationHandleRadiusPx;
  const anchor = { x: (left + right) / 2, y: handleAbove ? top : bottom };
  return {
    box: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }],
    anchor,
    handle: { x: anchor.x, y: anchor.y + (handleAbove ? -1 : 1) * rotationHandleOffsetPx / scale },
    center: geometryCenter(geometry),
  };
}
function rotateFrame(frame: TransformFrame, degrees: number): TransformFrame {
  const [anchor, handle, ...box] = rotateGeometry([frame.anchor, frame.handle, ...frame.box], degrees, frame.center);
  return { box, anchor, handle, center: frame.center };
}
function drawTransformFrame(ctx: CanvasRenderingContext2D, frame: TransformFrame, scale: number) {
  ctx.strokeStyle = "#f6effa";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  frame.box.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x * scale, point.y * scale);
    else ctx.lineTo(point.x * scale, point.y * scale);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(frame.anchor.x * scale, frame.anchor.y * scale);
  ctx.lineTo(frame.handle.x * scale, frame.handle.y * scale);
  ctx.stroke();
  ctx.fillStyle = "#be8cff";
  ctx.beginPath();
  ctx.arc(frame.handle.x * scale, frame.handle.y * scale, rotationHandleRadiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function drawToken(
  ctx: CanvasRenderingContext2D,
  t: RoomToken,
  center: Point,
  scale: number,
  selected: boolean,
  image?: HTMLImageElement,
) {
  const cx = center.x * scale;
  const cy = center.y * scale;
  const r = (n(t.size_m, 1) * scale) / 2;
  if (image?.complete && image.naturalWidth > 0) {
    // Center-crop the image to a square and clip it to the token's circle.
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
    if (t.is_hidden) {
      ctx.fillStyle = "rgba(128,115,142,.5)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = selected ? "#f6effa" : t.is_hidden ? "#80738e" : "#be8cff";
    ctx.lineWidth = selected ? 3 : 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = t.is_hidden ? "#80738e" : selected ? "#f6effa" : "#be8cff";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = t.is_hidden ? "#b8adc4" : "#f6effa";
  ctx.fillText(`${t.name}${t.is_hidden ? " (hidden)" : ""}`, cx + 8, cy);
  if (t.max_hit_points !== undefined && t.max_hit_points > 0 && t.hit_points !== undefined) {
    const width = Math.max(2 * r, 24);
    const left = cx - width / 2;
    const top = cy + r + 3;
    const ratio = Math.min(1, Math.max(0, t.hit_points / t.max_hit_points));
    ctx.fillStyle = "#40364c";
    ctx.fillRect(left, top, width, 4);
    ctx.fillStyle = ratio > 0.5 ? "#d9ffb5" : ratio > 0.25 ? "#ffb887" : "#ffa9a9";
    ctx.fillRect(left, top, width * ratio, 4);
  }
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
