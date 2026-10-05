import type { RoomToken, TokenSide } from "../api/types";
import { conditionLabel, statusLabels } from "./conditions";
import type { Point } from "./geometryTransforms";

/** Token colours by side, from the index.css palette: green yours, purple other players', peach the game master's. */
export const sideColors: Record<TokenSide, string> = { own: "#d9ffb5", party: "#be8cff", npc: "#ffb887" };

const ink = "#18151e";
const paper = "#f6effa";
const muted = "#b8adc4";
const fontFamily = "Outfit, ui-sans-serif, system-ui, sans-serif";
const statusColors = { down: "#ffb887", stable: "#ebc7ff", dead: muted } as const;
// Conditions beyond this many collapse into a "+N" badge.
const shownConditions = 3;
const maxNameLength = 18;

/**
 * Draws a token's body: coloured by side (or its image, ringed in that colour), greyed out when
 * down and crossed out when dead, with an outline ring when selected. Labels come from drawTokenLabels.
 */
export function drawToken(
  ctx: CanvasRenderingContext2D,
  t: RoomToken,
  center: Point,
  scale: number,
  selected: boolean,
  image?: HTMLImageElement,
) {
  const cx = center.x * scale;
  const cy = center.y * scale;
  const size = typeof t.size_m === "number" ? t.size_m : Number(t.size_m) || 1;
  const r = (size * scale) / 2;
  const color = sideColors[t.side ?? "party"];
  ctx.save();
  if (t.is_hidden) ctx.globalAlpha = 0.5;
  if (image?.complete && image.naturalWidth > 0) {
    // Center-crop the image to a square and clip it to the token's circle.
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, cx - r, cy - r, 2 * r, 2 * r);
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `700 ${Math.max(9, Math.round(r))}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.name.trim().charAt(0).toUpperCase(), cx, cy + 1);
  }
  if (t.status) {
    // Out of the fight: greyed for everyone, crossed out when dead.
    ctx.fillStyle = t.status === "dead" ? "rgba(24,21,30,0.72)" : "rgba(24,21,30,0.5)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    if (t.status === "dead") {
      const d = r * 0.55;
      ctx.strokeStyle = muted;
      ctx.lineWidth = Math.max(2, r / 6);
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - d);
      ctx.lineTo(cx + d, cy + d);
      ctx.moveTo(cx + d, cy - d);
      ctx.lineTo(cx - d, cy + d);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (selected) {
    // A dark halo under a light ring reads on any map, token colour or image.
    ctx.lineWidth = 5;
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = paper;
    ctx.stroke();
  }
}

/**
 * Draws a token's health bar, name pill, Down/Stable/Dead tag and condition badges. Called after
 * every token is drawn, so neighbouring tokens never cover a label.
 */
export function drawTokenLabels(ctx: CanvasRenderingContext2D, t: RoomToken, center: Point, scale: number, selected: boolean) {
  const cx = center.x * scale;
  const cy = center.y * scale;
  const r = ((typeof t.size_m === "number" ? t.size_m : Number(t.size_m) || 1) * scale) / 2;
  let below = cy + r + (selected ? 7 : 3);
  if (t.max_hit_points !== undefined && t.max_hit_points > 0 && t.hit_points !== undefined) {
    const width = Math.max(2 * r, 24);
    const left = cx - width / 2;
    const ratio = Math.min(1, Math.max(0, t.hit_points / t.max_hit_points));
    ctx.fillStyle = "#40364c";
    ctx.fillRect(left, below, width, 4);
    ctx.fillStyle = ratio > 0.5 ? "#d9ffb5" : ratio > 0.25 ? "#ffb887" : "#ffa9a9";
    ctx.fillRect(left, below, width * ratio, 4);
    below += 6;
  }
  ctx.save();
  const name = t.name.length > maxNameLength ? `${t.name.slice(0, maxNameLength - 1)}…` : t.name;
  pill(ctx, `${name}${t.is_hidden ? " (hidden)" : ""}`, cx, below, 12, t.is_hidden ? muted : paper, "rgba(24,21,30,0.86)");
  // The tag sits on the greyed token itself; conditions stack upwards above it.
  if (t.status) pill(ctx, statusLabels[t.status], cx, cy - 8, 11, statusColors[t.status], "rgba(24,21,30,0.92)");
  const conditions = t.conditions ?? [];
  const badges = conditions.length > shownConditions
    ? [...conditions.slice(0, shownConditions - 1).map(conditionLabel), `+${conditions.length - shownConditions + 1}`]
    : conditions.map(conditionLabel);
  const above = cy - r - (selected ? 7 : 3);
  badges.forEach((badge, index) => pill(ctx, badge, cx, above - (index + 1) * 16, 10, "#ebc7ff", "rgba(44,36,54,0.94)"));
  ctx.restore();
}

/** Draws text on a rounded pill centred on `cx`, its top edge at `top`. */
function pill(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, fontPx: number, color: string, background: string) {
  ctx.font = `600 ${fontPx}px ${fontFamily}`;
  const height = fontPx + 4;
  const width = ctx.measureText(text).width + height;
  const left = cx - width / 2;
  const radius = height / 2;
  ctx.fillStyle = background;
  ctx.beginPath();
  ctx.arc(left + radius, top + radius, radius, Math.PI / 2, Math.PI * 1.5);
  ctx.arc(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, top + radius + 0.5);
}
