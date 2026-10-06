import { assetURL } from "../api/client";
import type { GameMap, MapStructure } from "../api/types";
import { structureColor } from "../lib/structureStyle";

/** A small picture of a map: its background image with the outlines of its walls, doors and areas on top. */
export function MapThumbnail({ map, structures }: { map: GameMap; structures: Pick<MapStructure, "kind" | "geometry">[] }) {
  const width = Math.max(Number(map.width_m) || 30, 0.1);
  const height = Math.max(Number(map.height_m) || 30, 0.1);
  return <svg
    className="h-full w-full"
    viewBox={`0 0 ${width} ${height}`}
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label={`Preview of ${map.name}`}
  >
    <rect width={width} height={height} fill="#221c2b" />
    {map.background_asset_id && <image href={assetURL(map.background_asset_id)} width={width} height={height} preserveAspectRatio="none" />}
    {structures.map((structure, index) => <polyline
      key={index}
      points={structure.geometry.map((point) => `${point.x},${point.y}`).join(" ")}
      fill={structure.kind === "terrain" ? "rgba(217,255,181,0.2)" : "none"}
      stroke={structureColor(structure.kind)}
      strokeWidth={structure.kind === "terrain" ? 1 : 2}
      strokeDasharray={structure.kind === "cover" ? "1 3" : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />)}
    <rect width={width} height={height} fill="none" stroke="#be8cff" strokeWidth={1} vectorEffect="non-scaling-stroke" />
  </svg>;
}
