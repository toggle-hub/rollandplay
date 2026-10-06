import type { MapStructure } from "../api/types";
import type { Point } from "./geometryTransforms";

/** Each structure kind's color, matching the palette in the README. */
export const structureColors: Record<string, string> = {
  wall: "#be8cff",
  door: "#ffb887",
  window: "#ebc7ff",
  terrain: "#d9ffb5",
  cover: "#ffa9a9",
};

const jambPx = 6;

/** Stretches the map's background image over the whole board. Draw it before the grid so the grid stays on top. */
export function drawMapBackground(ctx: CanvasRenderingContext2D, image: HTMLImageElement | undefined, width: number, height: number) {
  if (!image?.complete || image.naturalWidth === 0) return false;
  ctx.drawImage(image, 0, 0, width, height);
  return true;
}

/**
 * Draws a door so open and closed read apart without relying on color. A closed door is a thick bar between
 * two jamb ticks. An open door keeps its jambs and a faint line across the doorway, and shows its leaf swung
 * 90° on the first point with a dashed swing arc. Doors with more than two points are drawn dashed when open.
 */
export function drawDoor(ctx: CanvasRenderingContext2D, door: MapStructure, geometry: Point[], scale: number, selected: boolean) {
  if (geometry.length < 2) return;
  const color = door.is_hidden ? "#80738e" : selected ? "#f6effa" : structureColors.door;
  const points = geometry.map((point) => ({ x: point.x * scale, y: point.y * scale }));
  ctx.strokeStyle = color;
  const polyline = (width: number, dash: number[]) => {
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (points.length > 2) {
    polyline(door.is_open ? 2 : 5, door.is_open || door.is_hidden ? [6, 5] : []);
    return;
  }
  const [a, b] = points;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return;
  // Unit vectors along the door and across it.
  const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const across = { x: along.y, y: -along.x };
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  [a, b].forEach((end) => {
    ctx.moveTo(end.x - across.x * jambPx, end.y - across.y * jambPx);
    ctx.lineTo(end.x + across.x * jambPx, end.y + across.y * jambPx);
  });
  ctx.stroke();
  if (!door.is_open) {
    polyline(5, door.is_hidden ? [6, 5] : []);
    return;
  }
  polyline(1, [3, 4]);
  ctx.lineWidth = 3;
  ctx.setLineDash(door.is_hidden ? [6, 5] : []);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + across.x * length, a.y + across.y * length);
  ctx.stroke();
  const closedAngle = Math.atan2(along.y, along.x);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(a.x, a.y, length, closedAngle - Math.PI / 2, closedAngle);
  ctx.stroke();
  ctx.setLineDash([]);
}
