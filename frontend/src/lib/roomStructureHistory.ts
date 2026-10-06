import { useCallback, useEffect, useRef, useState } from "react";
import { requestId } from "../api/client";
import type { MapStructure, ServerEnvelope } from "../api/types";
import type { Point } from "./geometryTransforms";
import { structureLabel, type StructureBlocks } from "./structures";

/** Sends one room websocket action under the given request id; false when it could not be sent. */
export type SendRoomAction = (type: string, body: unknown, id?: string) => boolean;
export type NewStructure = StructureBlocks & { kind: string; geometry: Point[] };

/** One structure change the game master made at the table, with what it takes to reverse it. */
type Change =
  | { action: "place"; kind: string; requestId: string; structureId?: string }
  | { action: "move"; kind: string; requestId: string; structureId: string; from: Point[] }
  | { action: "remove"; kind: string; requestId: string; structureId: string };

/** How many changes Undo can walk back. */
export const maxStructureUndo = 20;

const pastTense = { place: "placed", move: "moved", remove: "removed" } as const;

/**
 * The game master's latest structure changes at the table, newest last. A placed structure can be undone
 * once the server answers with its id; a change the server rejects is forgotten.
 */
export class StructureHistory {
  private changes: Change[] = [];

  record(change: Change) {
    this.changes.push(change);
    if (this.changes.length > maxStructureUndo) this.changes.shift();
  }

  /** Matches a server reply to the change that caused it. Returns true when the history changed. */
  observe(event: ServerEnvelope): boolean {
    if (!event.requestId) return false;
    const index = this.changes.findIndex((change) => change.requestId === event.requestId);
    if (index < 0) return false;
    const change = this.changes[index];
    if (event.type === "error") {
      this.changes.splice(index, 1);
      return true;
    }
    const body = event.body as { structure?: { id?: unknown } } | null;
    if (event.type === "structure.created" && change.action === "place" && typeof body?.structure?.id === "string") {
      this.changes[index] = { ...change, structureId: body.structure.id };
      return true;
    }
    return false;
  }

  /** What Undo reverses next, such as "removed wall", and whether it can be undone yet. */
  next(): { label: string; ready: boolean } | null {
    const change = this.changes.at(-1);
    if (!change) return null;
    return { label: `${pastTense[change.action]} ${structureLabel(change.kind).toLowerCase()}`, ready: !!change.structureId };
  }

  /** Sends the action that reverses the latest change and forgets that change. False when nothing was sent. */
  undo(send: SendRoomAction): boolean {
    const change = this.changes.at(-1);
    if (!change?.structureId) return false;
    const structureId = change.structureId;
    const sent = change.action === "place"
      ? send("structure.remove", { structureId })
      : change.action === "move"
        ? send("structure.move", { structureId, geometry: change.from })
        : send("structure.restore", { structureId });
    if (sent) this.changes.pop();
    return sent;
  }

  clear() {
    this.changes = [];
  }
}

/**
 * Sends the game master's structure place, move and remove actions and keeps them undoable: Undo, or
 * Ctrl/Cmd+Z outside text fields, sends the reverse action. The history starts over when the active map changes.
 */
export function useRoomStructureHistory(send: SendRoomAction, mapId: string, enabled: boolean) {
  const [history] = useState(() => new StructureHistory());
  const [, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((version) => version + 1), []);
  const sendRef = useRef(send);
  sendRef.current = send;
  const previousMapId = useRef(mapId);
  useEffect(() => {
    // Placing the first structure in a map-less room starts a map; that placement stays undoable.
    if (previousMapId.current) {
      history.clear();
      changed();
    }
    previousMapId.current = mapId;
  }, [mapId]);

  const undo = useCallback(() => {
    if (history.undo(sendRef.current)) changed();
  }, []);
  const observe = useCallback((event: ServerEnvelope) => {
    if (history.observe(event)) changed();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, undo]);

  function track(type: string, body: unknown, change: (id: string) => Change) {
    const id = requestId();
    if (!sendRef.current(type, body, id)) return false;
    history.record(change(id));
    changed();
    return true;
  }

  return {
    place: (structure: NewStructure) =>
      track("structure.create", structure, (id) => ({ action: "place", kind: structure.kind, requestId: id })),
    move: (structure: MapStructure, geometry: Point[]) =>
      track("structure.move", { structureId: structure.id, geometry }, (id) => ({ action: "move", kind: structure.kind, requestId: id, structureId: structure.id, from: structure.geometry })),
    remove: (structure: MapStructure) =>
      track("structure.remove", { structureId: structure.id }, (id) => ({ action: "remove", kind: structure.kind, requestId: id, structureId: structure.id })),
    undo,
    observe,
    next: history.next(),
  };
}
