import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SignIn } from "@phosphor-icons/react";
import { apiFetch, postJSON } from "../api/client";
import type { MapRoomChoice } from "../api/types";

/**
 * "Use in room…": lists the rooms the user runs, makes this map the chosen room's active map and opens the
 * room. `beforeLeave` finishes the editor's pending saves first, so the table gets the latest map.
 */
export function UseMapInRoom({ mapId, beforeLeave, onError }: { mapId: string; beforeLeave: () => Promise<void>; onError: (message: string) => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<MapRoomChoice[] | null>(null);
  const [roomId, setRoomId] = useState("");
  const [working, setWorking] = useState(false);
  const panelRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRooms(null);
    apiFetch<MapRoomChoice[]>(`/api/maps/${mapId}/rooms`)
      .then((items) => {
        if (cancelled) return;
        setRooms(items ?? []);
        setRoomId(items?.[0]?.id ?? "");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setOpen(false);
        onError(`Could not list your rooms: ${err.message}`);
      });
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !panelRef.current?.parentElement?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open, mapId]);

  async function useInRoom(event: FormEvent) {
    event.preventDefault();
    const room = rooms?.find((candidate) => candidate.id === roomId);
    if (!room) return;
    setWorking(true);
    try {
      await beforeLeave();
      if (!room.is_active) await postJSON(`/api/rooms/${room.id}/maps`, { map_id: mapId, is_active: true });
      navigate(`/rooms/${room.id}`);
    } catch (err) {
      onError(err instanceof Error ? `Could not use the map in ${room.name}: ${err.message}` : `Could not use the map in ${room.name}.`);
      setWorking(false);
    }
  }

  const chosen = rooms?.find((room) => room.id === roomId);
  return <div className="relative">
    <button className="btn" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}><SignIn size={18} aria-hidden="true" />Use in room…</button>
    {open && <form ref={panelRef} className="card absolute right-0 top-full z-40 mt-2 grid w-[min(340px,calc(100vw-48px))] gap-3 shadow-2xl" onSubmit={(event) => void useInRoom(event)} aria-label="Use this map in a room">
      {rooms === null ? <p role="status" className="text-muted text-sm">Loading your rooms…</p> : rooms.length === 0 ? <p className="text-muted text-sm">You don’t run any rooms yet. <Link className="text-[var(--accent)] underline underline-offset-4" to="/rooms">Create a room</Link> first.</p> : <>
        <label className="field-label" htmlFor="use-in-room">
          Room
          <select id="use-in-room" className="w-full" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
        </label>
        {chosen && <p className="text-muted text-xs">{chosen.is_active ? "This map is already on that table." : chosen.active_map_name ? `Replaces “${chosen.active_map_name}” as the table’s map. Its tokens stay with it and come back if you switch back.` : "The table has no map yet."}</p>}
        <button className="btn" type="submit" disabled={working || !chosen}>{working ? "Opening…" : chosen?.is_active ? "Open room" : "Use map and open room"}</button>
      </>}
    </form>}
  </div>;
}
