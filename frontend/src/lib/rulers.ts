import type { RoomMember } from "../api/types";
import type { Point } from "./geometryTransforms";

/** A ruler someone else at the table is holding, as `ruler.shown` sends it. */
export type SharedRuler = { conn_id: string; user_id: string; from: Point; to: Point };
/** A shared ruler as the map draws it, labelled with who is measuring. */
export type RemoteRuler = { id: string; from: Point; to: Point; name?: string };

export function isSharedRuler(body: unknown): body is SharedRuler {
  if (!body || typeof body !== "object") return false;
  const ruler = body as Record<string, unknown>;
  return typeof ruler.conn_id === "string" && typeof ruler.user_id === "string" && isPoint(ruler.from) && isPoint(ruler.to);
}

export function isClearedRuler(body: unknown): body is { conn_id: string } {
  return !!body && typeof body === "object" && "conn_id" in body && typeof body.conn_id === "string";
}

export function remoteRulers(rulers: ReadonlyMap<string, SharedRuler>, members: readonly RoomMember[]): RemoteRuler[] {
  return [...rulers.values()].map((ruler) => ({
    id: ruler.conn_id,
    from: ruler.from,
    to: ruler.to,
    name: members.find((member) => member.user_id === ruler.user_id)?.username,
  }));
}

function isPoint(value: unknown): value is Point {
  return !!value && typeof value === "object" && "x" in value && "y" in value && typeof value.x === "number" && typeof value.y === "number";
}
