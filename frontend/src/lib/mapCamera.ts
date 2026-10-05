import type { Point } from "./geometryTransforms";

/** CSS pixels per meter at 100% zoom. */
export const pixelsPerMeter = 24;
/** The zoom range; a map that only fits further out widens it, and you can always zoom in to twice the fitted size. */
export const minZoom = 0.35;
export const maxZoom = 3;
/** How much of the map, in CSS pixels, always stays in view while panning. */
const keepVisiblePx = 64;

export type Size = { width: number; height: number };
/** Where map point (0, 0) sits in the view, in CSS pixels, and the zoom. */
export type Camera = { x: number; y: number; zoom: number };

/** The whole map as large as the view allows, centred. */
export function fitCamera(view: Size, map: Size): Camera {
  const fit = Math.min(view.width / (map.width * pixelsPerMeter), view.height / (map.height * pixelsPerMeter));
  const zoom = Number.isFinite(fit) && fit > 0 ? fit : 1;
  return {
    zoom,
    x: (view.width - map.width * pixelsPerMeter * zoom) / 2,
    y: (view.height - map.height * pixelsPerMeter * zoom) / 2,
  };
}

export function zoomRange(view: Size, map: Size) {
  const fit = fitCamera(view, map).zoom;
  return { min: Math.min(minZoom, fit), max: Math.max(maxZoom, fit * 2) };
}

/** Keeps the zoom in range and at least a strip of the map in view. */
export function clampCamera(camera: Camera, view: Size, map: Size): Camera {
  const { min, max } = zoomRange(view, map);
  const zoom = clamp(camera.zoom, min, max);
  const axis = (offset: number, viewSize: number, mapSize: number) => {
    const size = mapSize * pixelsPerMeter * zoom;
    const keep = Math.min(keepVisiblePx, size / 2, viewSize / 2);
    return clamp(offset, keep - size, viewSize - keep);
  };
  return { zoom, x: axis(camera.x, view.width, map.width), y: axis(camera.y, view.height, map.height) };
}

/** Zooms to `zoom`, keeping the map point under `anchor` (view pixels) where it is. */
export function zoomAt(camera: Camera, anchor: Point, zoom: number, view: Size, map: Size): Camera {
  const { min, max } = zoomRange(view, map);
  const next = clamp(zoom, min, max);
  const ratio = next / camera.zoom;
  return clampCamera({ zoom: next, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio }, view, map);
}

/**
 * A two-finger gesture: zooms by how far the fingers spread since it began, and keeps the map point
 * that was under their midpoint under it now, so the map follows the fingers as they pan.
 */
export function pinchCamera(start: Camera, startMid: Point, startDistance: number, mid: Point, distance: number, view: Size, map: Size): Camera {
  const { min, max } = zoomRange(view, map);
  const zoom = clamp(start.zoom * (distance / Math.max(startDistance, 1)), min, max);
  const anchor = viewToMap(start, startMid);
  const scale = pixelsPerMeter * zoom;
  return clampCamera({ zoom, x: mid.x - anchor.x * scale, y: mid.y - anchor.y * scale }, view, map);
}

/** How much one wheel event zooms: a mouse notch about 18%, trackpad scrolls and pinches smoothly. */
export function wheelZoomFactor(event: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey">, viewHeight: number) {
  const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * viewHeight : event.deltaY;
  // Browsers report a trackpad pinch as a Ctrl+wheel with small deltas.
  const rate = event.ctrlKey ? 0.01 : 0.002;
  return Math.exp(-clamp(pixels, -100, 100) * rate);
}

export function viewToMap(camera: Camera, point: Point): Point {
  const scale = pixelsPerMeter * camera.zoom;
  return { x: (point.x - camera.x) / scale, y: (point.y - camera.y) / scale };
}

export function mapToView(camera: Camera, point: Point): Point {
  const scale = pixelsPerMeter * camera.zoom;
  return { x: camera.x + point.x * scale, y: camera.y + point.y * scale };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
