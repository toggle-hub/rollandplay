import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { assetURL } from "../api/client";
import type { MapStructure, RoomToken, VisibleRoomState } from "../api/types";
import { choiceRequest, choiceTargeting, choiceTitle, confirmLines, type ActionRequest, type FloatTone, type WheelChoice } from "../lib/actions";
import { attackLineBlocked, attackTargetStatus, type AttackTargetStatus } from "../lib/attacks";
import type { QuickCheckGroup } from "../lib/checks";
import { geometryCenter, rotateGeometry, type Point } from "../lib/geometryTransforms";
import { structureLabel, templateGeometry } from "../lib/structures";
import { extendPath, movementBarriers, walkToken } from "../lib/movement";
import { clampTokenCenter, snapTokenCenter } from "../lib/tokenGrid";
import { castVision } from "../lib/vision";
import { ActionConfirmCard } from "./ActionConfirmCard";
import { TokenActionWheel } from "./TokenActionWheel";

export type MapSelection = { kind: "tokens"; ids: string[] } | { kind: "structure"; id: string };
/** A short result floated above a token, such as the damage an action just dealt. */
export type FloatingResult = { id: string; tokenId: string; text: string; tone: FloatTone };
type Props = {
  state: VisibleRoomState;
  selectedTokenIds?: readonly string[];
  selectedStructureId?: string;
  movableTokenIds?: ReadonlySet<string>;
  canMoveStructures?: boolean;
  rulerDistanceMeters?: number;
  /** `path` is the way the token walked around movement-blocking structures, from where it started to `to`. */
  onMoveToken?: (tokenId: string, to: Point, path: Point[]) => void;
  onMoveTokens?: (moves: TokenMove[]) => void;
  onMoveStructure?: (structureId: string, geometry: Point[]) => void;
  onMeasure?: (from: Point, to: Point) => void;
  onSelect?: (selection: MapSelection | null) => void;
  /** Sent when the viewer presses Roll on the confirm card of an action, check or death save. */
  onAction?: (request: ActionRequest) => void;
  onEditActions?: (tokenId: string) => void;
  /** The action wheel's Checks, built from the room rule book; D&D checks when absent. */
  checkGroups?: QuickCheckGroup[];
  floatingResults?: readonly FloatingResult[];
  placingStructure?: { kind: string } | null;
  onPlaceStructure?: (geometry: Point[]) => void;
  onCancelPlacement?: () => void;
  /** Where tokens dragged by someone else at the table are right now. */
  remoteDragPositions?: ReadonlyMap<string, Point>;
  /** Live positions of the tokens being dragged, before they are dropped. */
  onDragTokens?: (moves: { tokenId: string; to: Point }[]) => void;
  /** The live drag ended without a move: the tokens never left where they started. */
  onDragTokensEnd?: () => void;
};
export type TokenMove = { tokenId: string; to: Point; path: Point[] };
type TokenDrag = {
  /** Every token moving together; the grabbed one leads and, with Shift held, snaps to the grid. */
  tokens: RoomToken[];
  grabbed: RoomToken;
  /** Pointer position relative to the grabbed token's center, so the token does not jump under the pointer. */
  grabOffset: Point;
  from: Point;
  current: Point;
  clientX: number;
  clientY: number;
  moved: boolean;
  /** Shift is held, so the dragged tokens snap to the grid. */
  snap: boolean;
  /** Where each token is now. It follows the pointer until a movement-blocking structure stops it. */
  at: ReadonlyMap<string, Point>;
  /** The way each token walked from where it started to where it is, sent with the drop. */
  paths: ReadonlyMap<string, Point[]>;
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
const floatColors: Record<FloatTone, string> = {
  damage: "#ffa9a9",
  heal: "#d9ffb5",
  miss: "#b8adc4",
  info: "#ebc7ff",
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
  onAction,
  onEditActions,
  checkGroups,
  floatingResults,
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
  // The drag as of the latest event, ahead of the render that draws it.
  const dragRef = useRef<TokenDrag | null>(null);
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
  const [actionWheel, setActionWheel] = useState<{ tokenId: string; x: number; y: number } | null>(null);
  const [rangePreview, setRangePreview] = useState<{ tokenId: string; rangeM: number } | null>(null);
  const [targeting, setTargeting] = useState<{ tokenId: string; choice: WheelChoice; hoverTokenId?: string; hoverPoint?: Point; message?: string } | null>(null);
  // A chosen action waiting on the confirm card's Roll.
  const [pending, setPending] = useState<{ sourceTokenId: string; choice: WheelChoice; targetTokenId?: string; point?: Point } | null>(null);
  const [placementPoint, setPlacementPoint] = useState<Point | null>(null);
  const placingKind = placingStructure?.kind;
  const findToken = (tokenId?: string) => tokenId === undefined ? undefined : state.visibleTokens.find((token) => token.id === tokenId);
  const targetingSource = findToken(targeting?.tokenId);
  const targetingSpec = targeting ? choiceTargeting(targeting.choice) : null;
  const wheelToken = findToken(actionWheel?.tokenId);
  const pendingSource = findToken(pending?.sourceTokenId);
  const pendingTarget = findToken(pending?.targetTokenId);
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
  // Where the dragged tokens head for, ignoring structures. Free, the grabbed one stays under the pointer, to the
  // hundredth of a meter the server stores; with Shift it snaps to the grid. The rest keep their offsets to it.
  function dragTargets(tokenDrag: TokenDrag, pointer: Point, snap: boolean) {
    if (!snap) {
      return new Map([...followPositions(tokenDrag, pointer)].map(([id, p]) => [id, { x: round(p.x), y: round(p.y) }]));
    }
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
  // Free drag positions: the grabbed token stays under the pointer and the rest keep their offsets to it.
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
  // Moves the drag to the pointer. Once it counts as a drag, each token walks toward its target and stops at
  // movement-blocking structures, sliding along them, so it never jumps through a wall.
  function advanceDrag(tokenDrag: TokenDrag, pointer: Point, snap: boolean, moved: boolean): TokenDrag {
    const next = { ...tokenDrag, current: pointer, snap, moved };
    if (!moved) return next;
    const barriers = movementBarriers(state.structures);
    const targets = dragTargets(next, pointer, snap);
    const at = new Map(tokenDrag.at);
    const paths = new Map(tokenDrag.paths);
    tokenDrag.tokens.forEach((token) => {
      const size = n(token.size_m, 1);
      const route = walkToken(at.get(token.id)!, targets.get(token.id)!, size / 2, barriers, (point) => clampTokenCenter(point, size, mapWidth, mapHeight));
      if (route.length === 0) return;
      const path = [...paths.get(token.id)!];
      route.forEach((point) => extendPath(path, point, barriers));
      at.set(token.id, route[route.length - 1]);
      paths.set(token.id, path);
    });
    return { ...next, at, paths };
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
    const positions = drag?.moved ? drag.at : undefined;
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
    const rangeSource = targetingSpec ? targetingSource : previewToken;
    const rangeM = targetingSpec?.rangeM ?? rangePreview?.rangeM;
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
    if (targeting && targetingSource && targetingSpec && targetingSpec.areaRadiusM > 0) {
      const at = targeting.hoverPoint;
      if (at) {
        const status = attackTargetStatus(tokenCenter(targetingSource), at, targetingSpec.rangeM, state.structures);
        const color = status !== "valid" ? "#80738e" : targetingSpec.tone === "heal" ? "#d9ffb5" : "#ffa9a9";
        const center = toCanvas(at);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(center.x, center.y, targetingSpec.areaRadiusM * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        areaTokens(at, targetingSpec.areaRadiusM).forEach((token) => {
          const ring = toCanvas(tokenCenter(token));
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, (n(token.size_m, 1) * scale) / 2 + 4, 0, Math.PI * 2);
          ctx.stroke();
        });
      }
    } else if (targeting && targetingSource && targetingSpec) {
      const from = tokenCenter(targetingSource);
      state.visibleTokens.forEach((token) => {
        if (token.id === targetingSource.id && !targetingSpec.allowSelf) return;
        const to = tokenCenter(token);
        const status = token.id === targetingSource.id ? "valid" : attackTargetStatus(from, to, targetingSpec.rangeM, state.structures);
        const center = toCanvas(to);
        ctx.strokeStyle = attackStatusColors[status];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(center.x, center.y, (n(token.size_m, 1) * scale) / 2 + 4, 0, Math.PI * 2);
        ctx.stroke();
        if (token.id !== targeting.hoverTokenId || token.id === targetingSource.id) return;
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
    if (floatingResults?.length) {
      const font = ctx.font;
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      floatingResults.forEach((result) => {
        const token = findToken(result.tokenId);
        if (!token) return;
        const center = toCanvas(livePosition(token));
        ctx.fillStyle = floatColors[result.tone];
        ctx.fillText(result.text, center.x, center.y - (n(token.size_m, 1) * scale) / 2 - 10);
      });
      ctx.textAlign = "start";
      ctx.font = font;
    }
  }, [state, selectedTokenIds, selectedStructureId, canMoveStructures, rulerDistanceMeters, drag, remoteDragPositions, marquee, structureDrag, ruler, rangePreview, targeting, placingKind, placementPoint, gridSize, imageVersion, floatingResults]);
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
    setPending(null);
    closeWheel();
  }, [placingKind]);
  useEffect(() => {
    if (targeting && !targetingSource) setTargeting(null);
    if (pending && !pendingSource) setPending(null);
    if (actionWheel && !wheelToken) setActionWheel(null);
    if (rangePreview && !previewToken) setRangePreview(null);
  }, [targeting, targetingSource, pending, pendingSource, actionWheel, wheelToken, rangePreview, previewToken]);
  function pickToken(point: Point, accept: (token: RoomToken) => boolean) {
    for (let index = state.visibleTokens.length - 1; index >= 0; index--) {
      const token = state.visibleTokens[index];
      if (accept(token) && Math.hypot(n(token.x_m) - point.x, n(token.y_m) - point.y) <= n(token.size_m, 1)) return token;
    }
  }
  // Visible tokens an area centred on `at` reaches: within its radius and with nothing blocking the way from the point.
  function areaTokens(at: Point, radiusM: number) {
    return state.visibleTokens.filter((token) => {
      const center = tokenCenter(token);
      return Math.hypot(center.x - at.x, center.y - at.y) <= radiusM + 1e-9 && !attackLineBlocked(at, center, state.structures);
    });
  }
  function closeWheel() {
    setActionWheel(null);
    setRangePreview(null);
  }
  function chooseAction(choice: WheelChoice) {
    if (!actionWheel) return;
    const tokenId = actionWheel.tokenId;
    closeWheel();
    if (choiceTargeting(choice)) {
      setTargeting({ tokenId, choice });
      ref.current?.focus({ preventScroll: true });
    } else {
      setPending({ sourceTokenId: tokenId, choice });
    }
  }
  function cancelTargeting() {
    setTargeting(null);
    ref.current?.focus({ preventScroll: true });
  }
  function closePending() {
    setPending(null);
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
  function updateDrag(next: TokenDrag | null) {
    dragRef.current = next;
    setDrag(next);
  }
  function streamDrag(tokenDrag: TokenDrag) {
    if (!tokenDrag.moved || !onDragTokens) return;
    streaming.current = true;
    onDragTokens(tokenDrag.tokens.map((token) => ({ tokenId: token.id, to: tokenDrag.at.get(token.id)! })));
  }
  // However the drag ends, a release, Escape or a lost pointer, the tokens stay where they walked to.
  function dropTokens(tokenDrag: TokenDrag) {
    updateDrag(null);
    const moves = tokenDrag.tokens.map((token) => ({ tokenId: token.id, to: tokenDrag.at.get(token.id)!, path: tokenDrag.paths.get(token.id)! }));
    const walked = tokenDrag.moved && moves.some(({ to, path }) => to.x !== path[0].x || to.y !== path[0].y);
    if (walked && moves.length === 1 && onMoveToken) onMoveToken(moves[0].tokenId, moves[0].to, moves[0].path);
    else if (walked && moves.length > 1 && onMoveTokens) onMoveTokens(moves);
    else {
      endStreaming();
      return;
    }
    // The move itself closes the live drag for the table.
    streaming.current = false;
  }
  // Pressing or releasing Shift mid-drag snaps or frees the tokens without waiting for the pointer to move.
  function setDragSnap(snap: boolean) {
    const current = dragRef.current;
    if (!current || current.snap === snap) return;
    const next = advanceDrag(current, current.current, snap, current.moved);
    updateDrag(next);
    streamDrag(next);
  }
  function cancelPointerAction() {
    if (dragRef.current) dropTokens(dragRef.current);
    endStreaming();
    rightGesture.current = null;
    pointerActive.current = false;
    setMarquee(null);
    setStructureDrag(null);
    setRuler(null);
  }
  // A right click without a drag on a token the viewer may act with opens its action wheel.
  function finishRightGesture(event: MouseEvent<HTMLCanvasElement> | PointerEvent<HTMLCanvasElement>) {
    const gesture = rightGesture.current;
    if (!gesture) return;
    cancelPointerAction();
    event.currentTarget.style.cursor = "default";
    if (gesture.moved || placingKind || !onAction) return;
    const token = pickToken(gesture.from, (candidate) => !!candidate.can_act);
    if (!token) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setActionWheel({ tokenId: token.id, x: event.clientX - rect.left, y: event.clientY - rect.top });
    setRangePreview(null);
    setTargeting(null);
    setPending(null);
    onSelect?.({ kind: "tokens", ids: [token.id] });
  }
  // Window blur drops a drag with this render's props and structures.
  const cancelLatest = useRef(cancelPointerAction);
  useEffect(() => {
    cancelLatest.current = cancelPointerAction;
  });
  useEffect(() => {
    const cancel = () => cancelLatest.current();
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, []);
  function pendingCard() {
    if (!pending || !pendingSource) return null;
    const { choice, targetTokenId, point } = pending;
    const source = pendingSource;
    const areaCount = point ? areaTokens(point, choiceTargeting(choice)?.areaRadiusM ?? 0).length : undefined;
    const subtitle = pendingTarget
      ? `${source.name} → ${pendingTarget.name}`
      : areaCount !== undefined
        ? `${source.name} → area · ${areaCount} ${areaCount === 1 ? "creature" : "creatures"} you can see`
        : source.name;
    return <ActionConfirmCard
      title={choiceTitle(choice)}
      subtitle={subtitle}
      lines={confirmLines(choice, pendingTarget, areaCount)}
      onRoll={() => {
        onAction?.(choiceRequest(source.id, choice, targetTokenId, point));
        closePending();
      }}
      onBack={choiceTargeting(choice) ? () => {
        setTargeting({ tokenId: source.id, choice });
        closePending();
      } : undefined}
      onCancel={closePending}
    />;
  }
  return (
    <div className="relative min-w-0">
      <canvas
        ref={ref}
        className="block h-auto w-full max-w-full touch-none rounded-xl border border-[var(--paper)]/15 bg-[var(--surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        role="img"
        tabIndex={0}
        aria-label="Interactive tabletop map. Drag a structure to move it. Drag the round handle above the selected structure to rotate it; hold Shift to snap rotation to 15 degrees. Drag a token to move it freely; hold Shift to snap it to the grid when dropped. Everyone at the table sees it move. Walls stop it and it slides along them; it stays wherever the drag ends. Drag across empty space to select several tokens, then drag one of them to move the group. Right click a token you control without dragging to open its action wheel, pick an attack, spell, item, check or death save, click a target or the point where an area lands, then press Roll on the confirm card. Hold the right mouse button and drag to measure distance; release to hide the ruler. Press Escape to end a drag where the token is, or to close the action wheel or cancel an action. While placing a structure, click the map to place it; press Escape to stop."
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if ((event.button !== 0 && event.button !== 2) || pointerActive.current) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pointerActive.current = true;
          closeWheel();
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
          if (pending) {
            setPending(null);
            return;
          }
          if (targeting) {
            if (!targetingSource || !targetingSpec) {
              setTargeting(null);
              return;
            }
            const from = tokenCenter(targetingSource);
            if (targetingSpec.areaRadiusM > 0) {
              const status = attackTargetStatus(from, point, targetingSpec.rangeM, state.structures);
              if (status === "valid") {
                setPending({ sourceTokenId: targetingSource.id, choice: targeting.choice, point: { x: round(point.x), y: round(point.y) } });
                setTargeting(null);
              } else {
                setTargeting({ ...targeting, message: status === "blocked" ? "Blocked by a structure" : "Out of range" });
              }
              return;
            }
            const target = pickToken(point, (candidate) => targetingSpec.allowSelf || candidate.id !== targetingSource.id);
            if (!target) {
              setTargeting(null);
              return;
            }
            const status = target.id === targetingSource.id ? "valid" : attackTargetStatus(from, tokenCenter(target), targetingSpec.rangeM, state.structures);
            if (status === "valid") {
              setPending({ sourceTokenId: targetingSource.id, choice: targeting.choice, targetTokenId: target.id });
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
            const at = new Map(tokens.map((candidate) => [candidate.id, tokenCenter(candidate)]));
            const from = at.get(token.id)!;
            updateDrag({
              tokens,
              grabbed: token,
              grabOffset: { x: point.x - from.x, y: point.y - from.y },
              from,
              current: point,
              clientX: event.clientX,
              clientY: event.clientY,
              moved: false,
              snap: event.shiftKey,
              at,
              paths: new Map([...at].map(([id, start]) => [id, [start]])),
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
            if (targeting && targetingSource && targetingSpec) {
              if (targetingSpec.areaRadiusM > 0) {
                setTargeting({ ...targeting, hoverPoint: point });
                event.currentTarget.style.cursor = "crosshair";
                return;
              }
              const hover = pickToken(point, (candidate) => targetingSpec.allowSelf || candidate.id !== targetingSource.id);
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
          const current = dragRef.current;
          if (current) {
            const moved = current.moved || Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= 4;
            const next = advanceDrag(current, point, event.shiftKey, moved);
            updateDrag(next);
            streamDrag(next);
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
          const current = dragRef.current;
          if (current) {
            const moved = current.moved || Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= 4;
            dropTokens(moved ? advanceDrag(current, eventPoint(event), event.shiftKey, true) : current);
            if (!moved) {
              // A click on one token of a group selects just that token.
              if (current.tokens.length > 1) onSelect?.({ kind: "tokens", ids: [current.grabbed.id] });
            }
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
          updateDrag(null);
          setMarquee(null);
          setStructureDrag(null);
          event.currentTarget.style.cursor = placingKind ? "crosshair" : "default";
        }}
        onPointerCancel={(event) => {
          cancelPointerAction();
          event.currentTarget.style.cursor = "default";
        }}
        // pointerdown already focuses the canvas; the browser's own mousedown focus would come later and
        // steal focus from the confirm card's Roll button that a target click just opened.
        onMouseDown={(event) => event.preventDefault()}
        onMouseUp={(event) => {
          // pointerup waits for the last held mouse button; mouseup does not.
          if (event.button === 2) finishRightGesture(event);
        }}
        onLostPointerCapture={cancelPointerAction}
        onBlur={cancelPointerAction}
        onKeyDown={(event) => {
          if (event.key === "Shift") setDragSnap(true);
          if (event.key !== "Escape") return;
          if (placingKind) onCancelPlacement?.();
          closeWheel();
          setTargeting(null);
          setPending(null);
          cancelPointerAction();
        }}
        onKeyUp={(event) => {
          if (event.key === "Shift") setDragSnap(false);
        }}
      />
      {actionWheel && wheelToken && <TokenActionWheel
        x={actionWheel.x}
        y={actionWheel.y}
        token={wheelToken}
        checkGroups={checkGroups}
        onPreview={(rangeM) => setRangePreview(rangeM === null ? null : { tokenId: wheelToken.id, rangeM })}
        onChoose={chooseAction}
        onEdit={wheelToken.actions_editable && onEditActions ? () => {
          onEditActions(wheelToken.id);
          closeWheel();
        } : undefined}
        onClose={() => {
          closeWheel();
          ref.current?.focus({ preventScroll: true });
        }}
      />}
      {placingKind ? <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-xs text-[var(--paper)] shadow-xl" role="status" aria-live="polite">
        <span>{`Placing ${structureLabel(placingKind)} — click the map to place it`}</span>
        <button className="shrink-0 text-[var(--accent)] underline underline-offset-4 hover:text-[var(--paper)]" type="button" onClick={stopPlacing}>Stop placing</button>
      </div> : targeting && targetingSpec ? <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-xs text-[var(--paper)] shadow-xl" role="status" aria-live="polite">
        <span>{targetingSpec.areaRadiusM > 0
          ? `${choiceTitle(targeting.choice)} · ${targetingSpec.areaRadiusM} m radius — click where it lands`
          : `${choiceTitle(targeting.choice)} · ${targetingSpec.rangeM} m — click a highlighted target`}{targeting.message && ` · ${targeting.message}`}</span>
        <button className="shrink-0 text-[var(--accent)] underline underline-offset-4 hover:text-[var(--paper)]" type="button" onClick={cancelTargeting}>Cancel</button>
      </div> : pendingCard()}
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
