/** Draws `text` on a dark rounded tag starting at `x`, centred on `y`, in CSS pixels, readable over any map. */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = "#f6effa") {
  ctx.save();
  ctx.font = "600 12px Outfit, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width + 12;
  ctx.fillStyle = "rgba(20,16,25,.88)";
  ctx.beginPath();
  ctx.roundRect(x, y - 10, width, 20, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 6, y);
  ctx.restore();
}
