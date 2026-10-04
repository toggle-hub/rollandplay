export type Point = { x: number; y: number };

const precision = 100;
const round = (value: number) => Math.round(value * precision) / precision;

export function rotateGeometry(geometry: Point[], degrees: number, origin?: Point): Point[] {
  if (geometry.length === 0) return geometry;
  const center = origin ?? geometryCenter(geometry);
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return geometry.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: round(center.x + dx * cos - dy * sin),
      y: round(center.y + dx * sin + dy * cos),
    };
  });
}

export function scaleGeometry(geometry: Point[], factor: number, origin?: Point): Point[] {
  if (geometry.length === 0) return geometry;
  const center = origin ?? geometryCenter(geometry);
  return geometry.map((point) => ({
    x: round(center.x + (point.x - center.x) * factor),
    y: round(center.y + (point.y - center.y) * factor),
  }));
}

export function nudgeGeometry(geometry: Point[], dx: number, dy: number): Point[] {
  return geometry.map((point) => ({ x: round(point.x + dx), y: round(point.y + dy) }));
}

export function flipGeometry(geometry: Point[], axis: "horizontal" | "vertical", origin?: Point): Point[] {
  if (geometry.length === 0) return geometry;
  const center = origin ?? geometryCenter(geometry);
  return geometry.map((point) => axis === "horizontal"
    ? { x: round(2 * center.x - point.x), y: point.y }
    : { x: point.x, y: round(2 * center.y - point.y) });
}

export function geometryBounds(geometry: Point[]) {
  if (geometry.length === 0) return { width: 0, height: 0 };
  const xs = geometry.map((point) => point.x);
  const ys = geometry.map((point) => point.y);
  return {
    width: round(Math.max(...xs) - Math.min(...xs)),
    height: round(Math.max(...ys) - Math.min(...ys)),
  };
}

export function geometryCenter(geometry: Point[]) {
  const xs = geometry.map((point) => point.x);
  const ys = geometry.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}
