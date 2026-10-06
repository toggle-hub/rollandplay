import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, MapTrifold, Plus, Trash } from "@phosphor-icons/react";
import { apiFetch, deleteJSON, postJSON } from "../api/client";
import type { GameMap } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { MapThumbnail } from "../components/MapThumbnail";

const newMapDefaults = { name: "", width: "30", height: "30", grid: "1.5" };

export function MapsPage() {
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(newMapDefaults);
  const [confirming, setConfirming] = useState("");
  const [deleting, setDeleting] = useState("");
  const navigate = useNavigate();
  const { session } = useSession();
  const userId = session.status === "authenticated" ? session.user.id : "";
  useEffect(() => { apiFetch<GameMap[]>("/api/maps").then((items) => setMaps(items ?? [])).catch((err: Error) => setError(err.message)).finally(() => setLoading(false)); }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const map = await postJSON<GameMap>("/api/maps", { name: draft.name.trim(), width_m: Number(draft.width), height_m: Number(draft.height), grid_size_m: Number(draft.grid) });
      navigate(`/maps/${map.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the map.");
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setDeleting(id); setError("");
    try { await deleteJSON<void>(`/api/maps/${id}`); setMaps((current) => current.filter((map) => map.id !== id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete the map."); }
    finally { setDeleting(""); setConfirming(""); }
  }
  const field = (key: "width" | "height" | "grid", label: string) => <label className="field-label" htmlFor={`new-map-${key}`}>
    {label}
    <input id={`new-map-${key}`} className="w-full" type="number" min="0.1" max={key === "grid" ? undefined : "1000"} step="any" required value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
  </label>;
  return <div className="workspace-page">
    <header className="flex flex-wrap items-end justify-between gap-6"><h1 className="page-heading">Maps</h1>{!creating && <button className="btn shrink-0" onClick={() => setCreating(true)}><Plus size={20} aria-hidden="true" />Create map</button>}</header>
    {creating && <form className="card grid gap-4 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] md:items-end" onSubmit={(event) => void create(event)} aria-label="New map">
      <label className="field-label" htmlFor="new-map-name">
        Name
        <input id="new-map-name" className="w-full" autoFocus placeholder="Untitled map" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      {field("width", "Width (m)")}
      {field("height", "Height (m)")}
      {field("grid", "Grid square (m)")}
      <p className="text-muted text-xs md:col-span-4">A 1.5 m grid square is 5 feet, the usual D&D square. You can change the size later, or fit it to a background image.</p>
      <div className="flex flex-wrap gap-3 md:col-span-4">
        <button className="btn" type="submit" disabled={busy}><Plus size={18} aria-hidden="true" />{busy ? "Creating…" : "Create and open editor"}</button>
        <button className="btn-secondary" type="button" disabled={busy} onClick={() => { setCreating(false); setDraft(newMapDefaults); }}>Cancel</button>
      </div>
    </form>}
    {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
    {loading ? <p role="status" className="text-muted">Loading maps…</p> : maps.length === 0 ? <section className="card empty-state py-20"><MapTrifold size={52} weight="thin" className="mx-auto mb-5 text-[var(--accent)]" aria-hidden="true" /><h2 className="text-2xl">No maps yet</h2><p className="text-muted mx-auto mt-3 max-w-sm text-sm leading-relaxed">Create a map to add a background, set the grid and draw walls for your first encounter.</p></section> : <div className="grid grid-flow-dense gap-5 md:grid-cols-2 xl:grid-cols-3">{maps.map((map) => <article className="card group flex min-w-0 flex-col transition-colors hover:border-[var(--accent)]/60" key={map.id}>
      <Link className="block min-w-0 flex-1" to={`/maps/${map.id}/edit`}><div className="mb-6 h-36 overflow-hidden rounded-lg border border-[var(--paper)]/10 bg-[var(--input)]/20"><MapThumbnail map={map} structures={map.preview_structures ?? []} /></div><div className="flex items-start justify-between gap-3"><h2 className="break-words text-xl">{map.name}</h2><ArrowUpRight size={22} className="shrink-0 text-[var(--accent)]" aria-hidden="true" /></div><p className="text-muted mt-3 text-sm">{map.width_m} m × {map.height_m} m<span className="mx-2">·</span>{map.grid_size_m} m grid</p><p className="mt-6 text-sm text-[var(--accent)]">Open map editor</p></Link>
      {map.owner_id === userId && <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--paper)]/10 pt-4">
        {confirming === map.id ? <>
          <span className="mr-auto text-sm text-[var(--pink)]">Delete map?</span>
          <button type="button" className="btn-secondary text-[var(--pink)]" onClick={() => remove(map.id)} disabled={deleting === map.id}>{deleting === map.id ? "Deleting…" : "Confirm"}</button>
          <button type="button" className="btn-secondary" onClick={() => setConfirming("")} disabled={deleting === map.id}>Cancel</button>
        </> : <button type="button" className="btn-secondary" aria-label={`Delete ${map.name}`} onClick={() => setConfirming(map.id)}><Trash size={18} aria-hidden="true" />Delete</button>}
      </div>}
    </article>)}</div>}
  </div>;
}
