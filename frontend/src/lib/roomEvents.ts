/**
 * What a room page loads over HTTP: the room state as this viewer sees it (map, tokens, structures,
 * chat, checks), the member list together with the viewer's characters, and the viewer's maps.
 */
export type RoomPart = "state" | "members" | "maps";

export const allRoomParts: RoomPart[] = ["state", "members", "maps"];

// Table events that change only what the room state holds.
const stateEvents: Record<string, true> = {
  "state.snapshot": true,
  "token.moved": true,
  "token.updated": true,
  "token.removed": true,
  "structure.created": true,
  "structure.moved": true,
  "structure.updated": true,
  "structure.removed": true,
  "vision.update": true,
  "check.changed": true,
  // A rejected action reloads the state so optimistic moves snap back.
  error: true,
};

/**
 * The parts to reload after a room websocket event. Chat messages, plain rolls and live drags are
 * applied from the event itself and reload nothing; an action roll reloads the state separately
 * because it changed hit points.
 */
export function partsToReload(type: string): RoomPart[] {
  if (stateEvents[type]) return ["state"];
  if (type === "map.activated") return ["state", "maps"];
  // Joining, leaving or changing characters: assigned sheets come from the viewer's character list.
  if (type.startsWith("member.")) return ["members"];
  return [];
}
