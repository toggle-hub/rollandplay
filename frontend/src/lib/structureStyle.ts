import type { Point } from "./geometryTransforms";

const colors: Record<string, string> = {
  wall: "#be8cff",
  door: "#ffb887",
  window: "#ebc7ff",
  terrain: "#d9ffb5",
  cover: "#ffa9a9",
};

export const structureColor = (kind: string) => colors[kind] ?? colors.wall;

/** Terrain and cover are areas: the draw tool closes them back to their first point. */
export const isAreaKind = (kind: string) => kind === "terrain" || kind === "cover";

export type StructureLook = {
  /** Canvas pixels per meter. */
  scale: number;
  /** Walls that don't block sight are drawn thinner. */
  blocksVision?: boolean;
  /** A glow under the piece: "selected" for the selection, "hover" for a layer row under the pointer. */
  halo?: "selected" | "hover";
  /** The Place tool's stamp preview: see-through and dashed. */
  ghost?: boolean;
};

const doorJamb = 7;

/**
 * Draws a structure so its type reads without color: walls are solid lines, doors carry a jamb tick at
 * each end, windows are hollow double lines, cover is dotted and terrain is a filled area.
 */
export function drawStructureShape(ctx: CanvasRenderingContext2D, kind: string, geometry: Point[], look: StructureLook) {
  if (geometry.length === 0) return;
  const points = geometry.map((point) => ({ x: point.x * look.scale, y: point.y * look.scale }));
  const trace = () => {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
  };
  const color = structureColor(kind);
  const width = kind === "window" ? 6 : kind === "terrain" ? 2 : kind === "wall" && look.blocksVision === false ? 2 : 4;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (look.ghost) ctx.globalAlpha = 0.8;
  if (look.halo) {
    trace();
    ctx.setLineDash([]);
    ctx.strokeStyle = look.halo === "selected" ? "rgba(246,239,250,0.65)" : "rgba(255,184,135,0.55)";
    ctx.lineWidth = width + 8;
    ctx.stroke();
  }
  trace();
  if (kind === "terrain" && points.length > 2) {
    ctx.fillStyle = look.halo ? "rgba(217,255,181,0.28)" : "rgba(217,255,181,0.16)";
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(look.ghost ? [8, 5] : kind === "cover" ? [2, 7] : []);
  ctx.stroke();
  if (kind === "window") {
    ctx.strokeStyle = "#141019";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (kind === "door" && points.length > 1) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const [end, next] of [[points[0], points[1]], [points[points.length - 1], points[points.length - 2]]]) {
      const length = Math.hypot(next.x - end.x, next.y - end.y) || 1;
      const nx = -(next.y - end.y) / length * doorJamb;
      const ny = (next.x - end.x) / length * doorJamb;
      ctx.moveTo(end.x - nx, end.y - ny);
      ctx.lineTo(end.x + nx, end.y + ny);
    }
    ctx.stroke();
  }
  ctx.restore();
}
