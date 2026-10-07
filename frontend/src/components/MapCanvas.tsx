import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Sword } from "@phosphor-icons/react";
import { assetURL } from "../api/client";
import type { MapStructure, RoomToken, VisibleRoomState } from "../api/types";
import { choiceRequest, choiceTargeting, choiceTitle, choiceUsesD20, confirmLines, type ActionRequest, type FloatTone, type WheelChoice } from "../lib/actions";
import { attackLineBlocked, attackTargetStatus, type AttackTargetStatus } from "../lib/attacks";
import { drawLabel } from "../lib/canvasLabel";
import { distanceLabel, formatMeters, pathLength } from "../lib/distance";
import type { QuickCheckGroup } from "../lib/checks";
import { geometryCenter, rotateGeometry, type Point } from "../lib/geometryTransforms";
import { clampCamera, fitCamera, mapToView, pinchCamera, pixelsPerMeter, viewToMap, wheelZoomFactor, zoomAt, type Camera, type Size } from "../lib/mapCamera";
import type { RemoteRuler } from "../lib/rulers";
import { stampGeometry, structureLabel, templateGeometry } from "../lib/structures";
import { drawDoor, drawMapBackground, structureColors } from "../lib/roomMapDrawing";
import { extendPath, movementBarriers, walkToken } from "../lib/movement";
import { clampTokenCenter, snapTokenCenter } from "../lib/tokenGrid";
import { drawToken, drawTokenLabels, drawTurnRing } from "../lib/tokenDrawing";
import { placementSpot } from "../lib/tokenPlacement";
import { currentTurnTokenId, turnLeft } from "../lib/turns";
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
  /** `path` is the way the token walked around movement-blocking structures, from where it started to `to`. */
  onMoveToken?: (tokenId: string, to: Point, path: Point[]) => void;
  onMoveTokens?: (moves: TokenMove[]) => void;
  onMoveStructure?: (structureId: string, geometry: Point[]) => void;
  /** Called while the viewer holds a ruler, so the table can see it. */
  onMeasure?: (from: Point, to: Point) => void;
  /** The viewer's ruler was released or cancelled. */
  onMeasureEnd?: () => void;
  /** Rulers others at the table are holding right now. */
  remoteRulers?: readonly RemoteRuler[];
  onSelect?: (selection: MapSelection | null) => void;
  /** Sent when the viewer presses Roll on the confirm card of an action, check or death save. */
  onAction?: (request: ActionRequest) => void;
  onEditActions?: (tokenId: string) => void;
  /** The action wheel's Checks, built from the room rule book; D&D checks when absent. */
  checkGroups?: QuickCheckGroup[];
  /** Why the viewer cannot attack, cast or use an item with a token this turn, else undefined. */
  turnBlockReason?: (tokenId: string) => string | undefined;
  floatingResults?: readonly FloatingResult[];
  /** The structure the next click places, turned by `rotationDeg` and sized by `scalePercent` (100 when unset). */
  placingStructure?: { kind: string; rotationDeg?: number; scalePercent?: number } | null;
  onPlaceStructure?: (geometry: Point[]) => void;
  onCancelPlacement?: () => void;
  /** A new token waiting for a click on the map; `sizeM` sizes its preview. */
  placingToken?: { label: string; sizeM: number } | null;
  /** Where the new token should stand: inside the map and moved off any token it would cover. */
  onPlaceToken?: (at: Point) => void;
  onCancelTokenPlacement?: () => void;
  /** Double-clicking a door opens or closes it; only game masters get this. */
  onToggleDoor?: (door: MapStructure) => void;
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
/** How far a press may wander, in CSS pixels, before it counts as a drag; fingers wobble more than mice. */
const mouseSlopPx = 4;
const touchSlopPx = 10;
/** Holding a finger on a token this long opens its action wheel. */
const longPressMs = 500;
/** Each zoom button press or +/- key zooms by this factor. */
const zoomStep = 1.25;

export function MapCanvas({
  state,
  selectedTokenIds,
  selectedStructureId,
  movableTokenIds,
  canMoveStructures = false,
  onMoveToken,
  onMoveTokens,
  onMoveStructure,
  onMeasure,
  onMeasureEnd,
  remoteRulers,
  onSelect,
  onAction,
  onEditActions,
  checkGroups,
  turnBlockReason,
  floatingResults,
  placingStructure,
  onPlaceStructure,
  onCancelPlacement,
  placingToken,
  onPlaceToken,
  onCancelTokenPlacement,
  onToggleDoor,
  remoteDragPositions,
  onDragTokens,
  onDragTokensEnd,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const pendingFrame = useRef<HTMLDivElement>(null);
  const fogLayer = useRef<HTMLCanvasElement | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [imageVersion, setImageVersion] = useState(0);
  const pointerActive = useRef(false);
  // How far the current press may move before it counts as a drag.
  const slop = useRef(mouseSlopPx);
  const rightGesture = useRef<{ from: Point; clientX: number; clientY: number; moved: boolean } | null>(null);
  // Whether this viewer's ruler has been shared with the table and needs taking back when it ends.
  const measuring = useRef(false);
  const spaceHeld = useRef(false);
  // A middle-button or Space drag that pans the view.
  const pan = useRef<{ pointerId: number; clientX: number; clientY: number; camera: Camera } | null>(null);
  // Fingers on the canvas, by pointer id, in client pixels; two of them pinch and pan the view.
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ camera: Camera; mid: Point; distance: number } | null>(null);
  const longPress = useRef<{ pointerId: number; clientX: number; clientY: number; timer: number } | null>(null);
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
  // Where the new token would stand if the viewer clicked now.
  const [tokenGhost, setTokenGhost] = useState<Point | null>(null);
  // Set when a click tried to place the new token somewhere the viewer cannot see.
  const [placeMessage, setPlaceMessage] = useState<string | null>(null);
  const [view, setView] = useState<Size>({ width: 0, height: 0 });
  // The view the viewer zoomed or panned to; null keeps the whole map fitted to the view.
  const [userCamera, setUserCamera] = useState<Camera | null>(null);
  const placingKind = placingStructure?.kind;
  const stampAt = (point: Point) => stampGeometry(placingKind!, point, gridSize, placingStructure?.rotationDeg ?? 0, placingStructure?.scalePercent ?? 100);
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
  const active = state.activeMap;
  const gridSize = n(active?.grid_size_m, n(state.metersPerGrid, 1));
  const mapWidth = n(active?.width_m, 30);
  const mapHeight = n(active?.height_m, 30);
  const mapSize = { width: mapWidth, height: mapHeight };
  const camera = userCamera ? clampCamera(userCamera, view, mapSize) : fitCamera(view, mapSize);
  // CSS pixels per meter at the current zoom. The context is translated to the camera but never scaled
  // by the zoom, so line widths, labels and handles keep their pixel sizes.
  const scale = pixelsPerMeter * camera.zoom;
  const toCanvas = (p: Point) => ({ x: p.x * scale, y: p.y * scale });
  const eventPoint = (event: Pick<PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>, "currentTarget" | "clientX" | "clientY">) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return viewToMap(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  const isMovable = (token: RoomToken) => movableTokenIds?.has(token.id) ?? true;
  // The one selected token the viewer may act with: the Actions button and Enter open its wheel.
  const actionToken = onAction && selectedTokenIds?.length === 1
    ? state.visibleTokens.find((token) => token.id === selectedTokenIds[0] && token.can_act)
    : undefined;
  function changeCamera(change: (current: Camera) => Camera) {
    setUserCamera((current) => change(current ? clampCamera(current, view, mapSize) : fitCamera(view, mapSize)));
  }
  function zoomBy(factor: number) {
    changeCamera((current) => zoomAt(current, { x: view.width / 2, y: view.height / 2 }, current.zoom * factor, view, mapSize));
  }
  // A new token goes where the viewer points, moved off any token they can see that it would cover.
  // Tokens hidden from the viewer are not in visibleTokens, so the nudge never gives them away.
  function tokenSpot(point: Point) {
    const others = state.visibleTokens.map((token) => ({ center: tokenCenter(token), sizeM: n(token.size_m, 1) }));
    return placementSpot(point, placingToken?.sizeM ?? 1, others, mapWidth, mapHeight, movementBarriers(state.structures));
  }
  // Under fog, a viewer who already sees part of the map places only where they see. A viewer with no sight
  // yet (a player bringing their character) may place anywhere; game masters have no fog.
  function canPlaceAt(point: Point) {
    const areas = state.visibility?.fog ? state.visibility.visionAreas : [];
    return areas.length === 0 || areas.some((area) => pointInPolygon(point, area.polygon));
  }
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
    if (!c || view.width === 0 || view.height === 0) return;
    const ctx = c.getContext("2d")!;
    // A backing store at the screen's pixel density keeps lines and text sharp.
    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.round(view.width * dpr);
    const backingHeight = Math.round(view.height * dpr);
    if (c.width !== backingWidth) c.width = backingWidth;
    if (c.height !== backingHeight) c.height = backingHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#141019";
    ctx.fillRect(0, 0, view.width, view.height);
    // From here on, drawing is in CSS pixels from the map's top-left corner.
    ctx.setTransform(dpr, 0, 0, dpr, camera.x * dpr, camera.y * dpr);
    const w = mapWidth * scale;
    const h = mapHeight * scale;
    ctx.fillStyle = "#221c2b";
    ctx.fillRect(0, 0, w, h);
    // The map's background image sits under the grid; players' fog is drawn over both.
    drawMapBackground(ctx, active?.background_asset_id ? images.current.get(active.background_asset_id) : undefined, w, h);
    ctx.strokeStyle = "#40364c";
    ctx.lineWidth = 1;
    const grid = n(state.metersPerGrid, 1) * scale;
    // Only the lines in view, and none once they would crowd into a solid fill.
    if (grid >= 4) {
      const right = Math.min(w, view.width - camera.x);
      const bottom = Math.min(h, view.height - camera.y);
      for (let x = Math.max(0, Math.floor(-camera.x / grid) * grid); x <= right; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = Math.max(0, Math.floor(-camera.y / grid) * grid); y <= bottom; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }
    // Tokens being dragged here or by someone else at the table are drawn, and see, from where they are now.
    const positions = drag?.moved ? drag.at : undefined;
    const livePosition = (token: RoomToken) => positions?.get(token.id) ?? remoteDragPositions?.get(token.id) ?? tokenCenter(token);
    drawStructures(ctx, state.structures, scale, selectedStructureId, structureDrag);
    if (state.visibility?.fog) {
      // Cut every token's sight out of an opaque layer, then lay that layer over the map.
      const layer = fogLayer.current ??= document.createElement("canvas");
      layer.width = backingWidth;
      layer.height = backingHeight;
      const fog = layer.getContext("2d")!;
      fog.setTransform(dpr, 0, 0, dpr, camera.x * dpr, camera.y * dpr);
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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, camera.x * dpr, camera.y * dpr);
    }
    const turnTokenId = currentTurnTokenId(state.combat);
    state.visibleTokens.forEach((t) => {
      const image = t.image_asset_id ? images.current.get(t.image_asset_id) : undefined;
      drawToken(ctx, t, livePosition(t), scale, !!selectedTokenIds?.includes(t.id), image);
      if (t.id === turnTokenId) drawTurnRing(ctx, t, livePosition(t), scale);
    });
    state.visibleTokens.forEach((t) => drawTokenLabels(ctx, t, livePosition(t), scale, !!selectedTokenIds?.includes(t.id)));
    const framed = canMoveStructures ? structureDrag?.structure ?? selectedStructure : undefined;
    if (framed) {
      const frame = structureDrag?.action === "rotate"
        ? rotateFrame(structureFrame(structureDrag.structure.geometry, scale), structureDrag.degrees)
        : structureFrame(structureDrag?.currentGeometry ?? framed.geometry, scale);
      drawTransformFrame(ctx, frame, scale);
    }
    if (placingKind && placementPoint) {
      ctx.strokeStyle = structureColors[placingKind] ?? "#be8cff";
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      stampAt(placementPoint).forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x * scale, point.y * scale);
        else ctx.lineTo(point.x * scale, point.y * scale);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (placingToken && tokenGhost) {
      const center = toCanvas(tokenGhost);
      const radius = (placingToken.sizeM * scale) / 2;
      const allowed = canPlaceAt(tokenGhost);
      ctx.fillStyle = allowed ? "rgba(190,140,255,.25)" : "rgba(128,115,142,.25)";
      ctx.strokeStyle = allowed ? "#be8cff" : "#80738e";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      drawLabel(ctx, placingToken.label, center.x + radius + 6, center.y);
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
    remoteRulers?.forEach((remote) => {
      const a = toCanvas(remote.from),
        b = toCanvas(remote.to);
      ctx.strokeStyle = "#ebc7ff";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const meters = Math.hypot(remote.to.x - remote.from.x, remote.to.y - remote.from.y);
      drawLabel(ctx, `${remote.name ? `${remote.name} · ` : ""}${distanceLabel(meters, gridSize)}`, b.x + 8, b.y - 12, "#ebc7ff");
    });
    if (ruler) {
      const a = toCanvas(ruler.from),
        b = toCanvas(ruler.to);
      ctx.strokeStyle = "#d9ffb5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      drawLabel(ctx, distanceLabel(Math.hypot(ruler.to.x - ruler.from.x, ruler.to.y - ruler.from.y), gridSize), b.x + 8, b.y - 12);
    }
    if (drag?.moved) {
      // How far the grabbed token walked, around walls, against its speed when the sheet has one;
      // on its turn in a fight, against what is left of that speed.
      const at = drag.at.get(drag.grabbed.id)!;
      const walked = pathLength(drag.paths.get(drag.grabbed.id)!);
      const speed = drag.grabbed.speed_m;
      const left = turnLeft(state.combat, drag.grabbed.id);
      const budget = speed === undefined ? undefined : left ? Math.max(0, speed - left.movedM) : speed;
      const tooFar = budget !== undefined && walked > budget + 1e-9;
      const suffix = speed === undefined || budget === undefined ? "" : left ? ` · ${formatMeters(Math.max(0, budget - walked))} m left` : tooFar ? ` · speed ${formatMeters(speed)} m` : "";
      const center = toCanvas(at);
      const radius = (n(drag.grabbed.size_m, 1) * scale) / 2;
      drawLabel(ctx, `${distanceLabel(walked, gridSize)}${suffix}`, center.x + radius + 6, center.y - radius, tooFar ? "#ffb887" : "#f6effa");
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
  }, [state, selectedTokenIds, selectedStructureId, canMoveStructures, drag, remoteDragPositions, remoteRulers, marquee, structureDrag, ruler, rangePreview, targeting, placingKind, placementPoint, placingStructure?.rotationDeg, placingStructure?.scalePercent, placingToken?.label, placingToken?.sizeM, tokenGhost, gridSize, imageVersion, floatingResults, view, camera.x, camera.y, scale]);
  useEffect(() => {
    const ids: (string | null | undefined)[] = state.visibleTokens.map((token) => token.image_asset_id);
    ids.push(state.activeMap?.background_asset_id);
    ids.forEach((id) => {
      if (!id || images.current.has(id)) return;
      const image = new Image();
      image.onload = () => setImageVersion((version) => version + 1);
      image.src = assetURL(id);
      images.current.set(id, image);
    });
  }, [state.visibleTokens, state.activeMap?.background_asset_id]);
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
    setPlaceMessage(null);
    if (!placingToken) {
      setTokenGhost(null);
      return;
    }
    setTargeting(null);
    setPending(null);
    closeWheel();
  }, [!!placingToken]);
  // Another map starts fitted to the view.
  useEffect(() => setUserCamera(null), [active?.id]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = ref.current;
    if (!root || !canvas) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      const fallback = canvas.getBoundingClientRect();
      const width = Math.round(rect.width || fallback.width);
      const height = Math.round(rect.height || fallback.height);
      if (width > 0 && height > 0) setView((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  // React's wheel listener is passive, and the page must not scroll while the map zooms.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const zoomWithWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = wheelZoomFactor(event, view.height);
      changeCamera((current) => zoomAt(current, anchor, current.zoom * factor, view, mapSize));
    };
    canvas.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", zoomWithWheel);
  }, [view, mapWidth, mapHeight]);
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
  // Opens the action wheel of a token the viewer may act with, at a point in view pixels.
  function openWheel(token: RoomToken, at: Point) {
    setActionWheel({ tokenId: token.id, x: at.x, y: at.y });
    setRangePreview(null);
    setTargeting(null);
    setPending(null);
    onSelect?.({ kind: "tokens", ids: [token.id] });
  }
  // A click on the map while the confirm card is open keeps it, and points the viewer back to it.
  function nudgePending() {
    const frame = pendingFrame.current;
    frame?.animate?.([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: 240 });
    frame?.querySelector<HTMLButtonElement>('[role="dialog"] button.btn')?.focus({ preventScroll: true });
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
  function stopPlacingToken() {
    onCancelTokenPlacement?.();
    ref.current?.focus({ preventScroll: true });
  }
  function cancelLongPress() {
    if (!longPress.current) return;
    window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  }
  // A finger held still on a token the viewer may act with opens its action wheel instead of dragging it.
  function longPressed(tokenId: string, at: Point) {
    longPress.current = null;
    const token = findToken(tokenId);
    if (!token || dragRef.current?.moved) return;
    updateDrag(null);
    endStreaming();
    setMarquee(null);
    pointerActive.current = false;
    openWheel(token, at);
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
    cancelLongPress();
    rightGesture.current = null;
    pointerActive.current = false;
    pan.current = null;
    pinch.current = null;
    setMarquee(null);
    setStructureDrag(null);
    setRuler(null);
    if (measuring.current) {
      measuring.current = false;
      onMeasureEnd?.();
    }
  }
  // A right click without a drag on a token the viewer may act with opens its action wheel.
  function finishRightGesture(event: MouseEvent<HTMLCanvasElement> | PointerEvent<HTMLCanvasElement>) {
    const gesture = rightGesture.current;
    if (!gesture) return;
    cancelPointerAction();
    event.currentTarget.style.cursor = "default";
    if (gesture.moved || placingKind || placingToken || !onAction) return;
    const token = pickToken(gesture.from, (candidate) => !!candidate.can_act);
    if (!token) return;
    const rect = event.currentTarget.getBoundingClientRect();
    openWheel(token, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }
  // Window blur drops a drag with this render's props and structures.
  const cancelLatest = useRef(cancelPointerAction);
  // A long press fires after a delay, with whatever the latest render holds.
  const longPressLatest = useRef(longPressed);
  useEffect(() => {
    cancelLatest.current = cancelPointerAction;
    longPressLatest.current = longPressed;
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
      rollOptions={choiceUsesD20(choice)}
      onRoll={(options) => {
        onAction?.(choiceRequest(source.id, choice, targetTokenId, point, options));
        closePending();
      }}
      onBack={choiceTargeting(choice) ? () => {
        setTargeting({ tokenId: source.id, choice });
        closePending();
      } : undefined}
      onCancel={closePending}
    />;
  }
  // Where the Actions button of the selected token sits: beside it, while nothing else is going on.
  const actionAnchor = actionToken && !placingKind && !placingToken && !targeting && !pending && !actionWheel && !drag?.moved
    ? mapToView(camera, remoteDragPositions?.get(actionToken.id) ?? tokenCenter(actionToken))
    : undefined;
  const actionAnchorInView = !!actionAnchor && actionAnchor.x >= 0 && actionAnchor.y >= 0 && actionAnchor.x <= view.width && actionAnchor.y <= view.height;
  const banner = "absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--paper)]/15 bg-[var(--input)] px-3 py-2 text-xs text-[var(--paper)] shadow-xl";
  const bannerButton = "shrink-0 text-[var(--accent)] underline underline-offset-4 hover:text-[var(--paper)]";
  const viewButton = "grid h-9 min-w-9 place-items-center rounded-md border border-[var(--paper)]/15 bg-[var(--input)] px-2 text-sm text-[var(--paper)] hover:border-[var(--accent)]";
  return (
    <div ref={rootRef} className="relative h-full min-h-0 w-full min-w-0 overflow-hidden rounded-xl border border-[var(--paper)]/15 bg-[var(--input)]">
      <canvas
        ref={ref}
        className="absolute inset-0 block h-full w-full touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
        role="img"
        tabIndex={0}
        aria-label="Interactive tabletop map. Scroll or pinch to zoom; drag with the middle mouse button, hold Space and drag, or drag with two fingers to pan; the plus and minus keys zoom and 0 fits the whole map. Drag a structure to move it. Drag the round handle above the selected structure to rotate it; hold Shift to snap rotation to 15 degrees. Drag a token to move it freely; hold Shift to snap it to the grid when dropped. The distance it walked shows beside it. Everyone at the table sees it move. Walls stop it and it slides along them; it stays wherever the drag ends. Drag across empty space to select several tokens, then drag one of them to move the group. To act with a token you control, right click it, press and hold it, or select it and press Enter or its Actions button; pick an attack, spell, item, check or death save, click a highlighted target or the point where an area lands, then press Roll on the confirm card. Hold the right mouse button and drag to measure distance; everyone at the table sees the ruler until you release it. Press Escape to end a drag where the token is, close the action wheel, cancel an action, or stop placing. While placing a structure or a token, click the map where it goes."
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          const canvas = event.currentTarget;
          if (event.pointerType === "touch") {
            touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (touches.current.size > 1) {
              // A second finger turns whatever the first one started into a pinch.
              if (touches.current.size === 2 && !pinch.current) {
                cancelPointerAction();
                canvas.setPointerCapture?.(event.pointerId);
                const [a, b] = [...touches.current.values()];
                const rect = canvas.getBoundingClientRect();
                pinch.current = { camera, mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, distance: Math.hypot(a.x - b.x, a.y - b.y) };
              }
              return;
            }
          }
          const panning = event.button === 1 || (event.button === 0 && spaceHeld.current);
          if (pinch.current || pan.current || pointerActive.current || (!panning && event.button !== 0 && event.button !== 2)) return;
          canvas.focus({ preventScroll: true });
          canvas.setPointerCapture?.(event.pointerId);
          closeWheel();
          if (panning) {
            pan.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, camera };
            canvas.style.cursor = "grabbing";
            return;
          }
          pointerActive.current = true;
          slop.current = event.pointerType === "touch" ? touchSlopPx : mouseSlopPx;
          const point = eventPoint(event);
          setRuler(null);
          if (event.button === 2) {
            rightGesture.current = { from: point, clientX: event.clientX, clientY: event.clientY, moved: false };
            return;
          }
          if (placingKind) {
            onPlaceStructure?.(stampAt(point));
            return;
          }
          if (placingToken) {
            const spot = tokenSpot(point);
            if (canPlaceAt(spot)) onPlaceToken?.(spot);
            else setPlaceMessage("You can only place it where you can see");
            return;
          }
          if (pending) {
            nudgePending();
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
              // A near miss keeps the action; only Esc or Cancel stops it.
              setTargeting({ ...targeting, message: "No target there — click a highlighted target" });
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
          const actor = event.pointerType === "touch" && onAction ? pickToken(point, (candidate) => !!candidate.can_act) : undefined;
          if (actor) {
            const rect = canvas.getBoundingClientRect();
            const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            longPress.current = {
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
              timer: window.setTimeout(() => longPressLatest.current(actor.id, at), longPressMs),
            };
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
          if (event.pointerType === "touch" && touches.current.has(event.pointerId)) {
            touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            const gesture = pinch.current;
            if (gesture) {
              const [a, b] = [...touches.current.values()];
              if (!b) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
              setUserCamera(pinchCamera(gesture.camera, gesture.mid, gesture.distance, mid, Math.hypot(a.x - b.x, a.y - b.y), view, mapSize));
              return;
            }
          }
          const panning = pan.current;
          if (panning) {
            if (event.pointerId !== panning.pointerId) return;
            setUserCamera(clampCamera({
              ...panning.camera,
              x: panning.camera.x + event.clientX - panning.clientX,
              y: panning.camera.y + event.clientY - panning.clientY,
            }, view, mapSize));
            return;
          }
          const press = longPress.current;
          if (press && event.pointerId === press.pointerId && Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >= slop.current) cancelLongPress();
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
            if (onMeasure) {
              measuring.current = true;
              onMeasure(gesture.from, point);
            }
            return;
          }
          if (!pointerActive.current) {
            if (spaceHeld.current) {
              event.currentTarget.style.cursor = "grab";
              return;
            }
            if (placingKind) {
              setPlacementPoint(point);
              event.currentTarget.style.cursor = "crosshair";
              return;
            }
            if (placingToken) {
              setTokenGhost(tokenSpot(point));
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
            const moved = current.moved || Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= slop.current;
            const next = advanceDrag(current, point, event.shiftKey, moved);
            updateDrag(next);
            streamDrag(next);
            return;
          }
          if (marquee) {
            setMarquee({ ...marquee, to: point, moved: marquee.moved || Math.hypot(event.clientX - marquee.clientX, event.clientY - marquee.clientY) >= slop.current });
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
          if (event.pointerType === "touch") touches.current.delete(event.pointerId);
          if (pinch.current) {
            if (touches.current.size < 2) pinch.current = null;
            return;
          }
          if (pan.current) {
            if (event.pointerId !== pan.current.pointerId) return;
            pan.current = null;
            event.currentTarget.style.cursor = spaceHeld.current ? "grab" : "default";
            return;
          }
          cancelLongPress();
          if (event.button === 2) {
            finishRightGesture(event);
            return;
          }
          if (!pointerActive.current) return;
          const current = dragRef.current;
          if (current) {
            const moved = current.moved || Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= slop.current;
            dropTokens(moved ? advanceDrag(current, eventPoint(event), event.shiftKey, true) : current);
            if (!moved) {
              // A click on one token of a group selects just that token.
              if (current.tokens.length > 1) onSelect?.({ kind: "tokens", ids: [current.grabbed.id] });
            }
          } else if (marquee) {
            if (marquee.moved || Math.hypot(event.clientX - marquee.clientX, event.clientY - marquee.clientY) >= slop.current) {
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
          event.currentTarget.style.cursor = placingKind || placingToken ? "crosshair" : "default";
        }}
        onPointerCancel={(event) => {
          touches.current.delete(event.pointerId);
          cancelPointerAction();
          event.currentTarget.style.cursor = "default";
        }}
        onPointerLeave={() => setTokenGhost(null)}
        // pointerdown already focuses the canvas; the browser's own mousedown focus would come later and
        // steal focus from the confirm card's Roll button that a target click just opened.
        onMouseDown={(event) => event.preventDefault()}
        onMouseUp={(event) => {
          // pointerup waits for the last held mouse button; mouseup does not.
          if (event.button === 2) finishRightGesture(event);
        }}
        onLostPointerCapture={(event) => {
          touches.current.delete(event.pointerId);
          cancelPointerAction();
        }}
        onDoubleClick={(event) => {
          if (!onToggleDoor || placingKind || targeting || pending) return;
          const point = eventPoint(event);
          const door = [...state.structures].reverse().find((structure) => structure.kind === "door" && hitsStructure(structure, point));
          if (door) onToggleDoor(door);
        }}
        onBlur={() => {
          spaceHeld.current = false;
          cancelPointerAction();
        }}
        onKeyDown={(event) => {
          if (event.key === "Shift") setDragSnap(true);
          if (event.key === " ") {
            // Space held turns a left drag into a pan instead of scrolling the page.
            event.preventDefault();
            spaceHeld.current = true;
            if (!pointerActive.current) event.currentTarget.style.cursor = pan.current ? "grabbing" : "grab";
            return;
          }
          if (event.key === "+" || event.key === "=") zoomBy(zoomStep);
          if (event.key === "-" || event.key === "_") zoomBy(1 / zoomStep);
          if (event.key === "0") setUserCamera(null);
          if (event.key === "Enter" && actionToken && !placingKind && !placingToken && !targeting && !pending) {
            event.preventDefault();
            openWheel(actionToken, mapToView(camera, tokenCenter(actionToken)));
            return;
          }
          if (event.key !== "Escape") return;
          if (placingKind) onCancelPlacement?.();
          if (placingToken) onCancelTokenPlacement?.();
          closeWheel();
          setTargeting(null);
          setPending(null);
          cancelPointerAction();
        }}
        onKeyUp={(event) => {
          if (event.key === "Shift") setDragSnap(false);
          if (event.key === " ") {
            spaceHeld.current = false;
            if (!pan.current) event.currentTarget.style.cursor = "default";
          }
        }}
      />
      {actionToken && actionAnchor && actionAnchorInView && <button
        className="absolute z-20 inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--accent)] bg-[var(--input)] px-2.5 text-xs font-medium text-[var(--paper)] shadow-xl hover:bg-[var(--surface-raised)]"
        style={{
          left: Math.max(4, Math.min(actionAnchor.x + (n(actionToken.size_m, 1) * scale) / 2 + 6, view.width - 96)),
          top: Math.max(4, Math.min(actionAnchor.y - 18, view.height - 40)),
        }}
        type="button"
        aria-label={`Actions for ${actionToken.name}`}
        onClick={() => openWheel(actionToken, actionAnchor)}
      >
        <Sword size={14} className="text-[var(--accent)]" aria-hidden="true" />Actions
      </button>}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-[var(--paper)]/10 bg-[var(--input)]/90 p-1 shadow-xl" role="group" aria-label="Map view">
        <button className={viewButton} type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / zoomStep)}>−</button>
        <span className="w-11 text-center text-xs tabular-nums text-[var(--muted)]">{Math.round(camera.zoom * 100)}%</span>
        <button className={viewButton} type="button" aria-label="Zoom in" onClick={() => zoomBy(zoomStep)}>+</button>
        <button className={`${viewButton} text-xs`} type="button" aria-label="Fit the whole map in view" aria-pressed={!userCamera} onClick={() => setUserCamera(null)}>Fit</button>
      </div>
      {actionWheel && wheelToken && <TokenActionWheel
        x={actionWheel.x}
        y={actionWheel.y}
        token={wheelToken}
        checkGroups={checkGroups}
        turnBlocked={turnBlockReason?.(wheelToken.id)}
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
      {placingKind ? <div className={banner} role="status" aria-live="polite">
        <span>{`Placing ${structureLabel(placingKind)} — click the map to place it`}</span>
        <button className={bannerButton} type="button" onClick={stopPlacing}>Stop placing</button>
      </div> : placingToken ? <div className={banner} role="status" aria-live="polite">
        <span>
          {`Placing ${placingToken.label} — `}
          <span className={placeMessage ? "text-[var(--pink)]" : undefined}>{placeMessage ?? "click the map where it should stand"}</span>
        </span>
        <button className={bannerButton} type="button" onClick={stopPlacingToken}>Cancel</button>
      </div> : targeting && targetingSpec ? <div className={banner} role="status" aria-live="polite">
        <span>
          {targetingSpec.areaRadiusM > 0
            ? `${choiceTitle(targeting.choice)} · ${targetingSpec.areaRadiusM} m radius — `
            : `${choiceTitle(targeting.choice)} · ${targetingSpec.rangeM} m — `}
          <span className={targeting.message ? "text-[var(--pink)]" : undefined}>
            {targeting.message ?? (targetingSpec.areaRadiusM > 0 ? "click where it lands" : "click a highlighted target")}
          </span>
        </span>
        <button className={bannerButton} type="button" onClick={cancelTargeting}>Cancel</button>
      </div> : pending && <div ref={pendingFrame} className="pointer-events-none absolute inset-0 z-30 [&>*]:pointer-events-auto">{pendingCard()}</div>}
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
    if (structure.kind === "door") {
      drawDoor(ctx, structure, geometry, scale, selected);
      return;
    }
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
