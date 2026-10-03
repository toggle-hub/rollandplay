import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, MapTrifold, Plus, Trash } from "@phosphor-icons/react";
import { apiFetch, deleteJSON, postJSON } from "../api/client";
import type { GameMap } from "../api/types";
import { useSession } from "../auth/SessionContext";

export function MapsPage() {
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState("");
  const [deleting, setDeleting] = useState("");
  const { session } = useSession();
  const userId = session.status === "authenticated" ? session.user.id : "";
  useEffect(() => { apiFetch<GameMap[]>("/api/maps").then((items) => setMaps(items ?? [])).catch((err: Error) => setError(err.message)).finally(() => setLoading(false)); }, []);
  async function create() {
    setBusy(true); setError("");
    try { const map = await postJSON<GameMap>("/api/maps", {}); setMaps((current) => [map, ...current]); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not create the map."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setDeleting(id); setError("");
    try { await deleteJSON<void>(`/api/maps/${id}`); setMaps((current) => current.filter((map) => map.id !== id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete the map."); }
    finally { setDeleting(""); setConfirming(""); }
  }
  return <div className="workspace-page">
    <header className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-end"><div><p className="eyebrow">Set the scene</p><h1 className="page-heading">Maps & battlefields</h1><p className="page-description">Build the places your party will remember. Shape the terrain, then let the story unfold.</p></div><button className="btn shrink-0" onClick={create} disabled={busy}><Plus size={20} aria-hidden="true" />{busy ? "Creating…" : "Create untitled map"}</button></header>
    {error && <p role="alert" className="text-[var(--pink)]">{error}</p>}
    {loading ? <p role="status" className="text-muted">Unrolling your maps…</p> : maps.length === 0 ? <section className="card empty-state py-20"><MapTrifold size={52} weight="thin" className="mx-auto mb-5 text-[var(--accent)]" aria-hidden="true" /><h2 className="text-2xl">Uncharted territory.</h2><p className="text-muted mx-auto mt-3 max-w-sm text-sm leading-relaxed">Your map collection is empty. Create a map to add a background, set the grid, and build your first encounter.</p></section> : <div className="grid grid-flow-dense gap-5 md:grid-cols-2 xl:grid-cols-3">{maps.map((map) => <article className="card group flex min-w-0 flex-col transition-colors hover:border-[var(--accent)]/60" key={map.id}>
      <Link className="block min-w-0 flex-1" to={`/maps/${map.id}/edit`}><div className="mb-6 flex h-36 items-center justify-center overflow-hidden rounded-lg border border-[var(--paper)]/10 bg-[var(--input)]/20"><MapTrifold size={64} weight="thin" aria-hidden="true" className="text-[var(--muted)] transition-transform duration-500 group-hover:scale-110 group-hover:text-[var(--accent)]" /></div><div className="flex items-start justify-between gap-3"><h2 className="break-words text-xl">{map.name}</h2><ArrowUpRight size={22} className="shrink-0 text-[var(--accent)]" aria-hidden="true" /></div><p className="text-muted mt-3 text-sm">{map.width_m} m × {map.height_m} m<span className="mx-2">·</span>{map.grid_size_m} m grid</p><p className="mt-6 text-sm text-[var(--accent)]">Open map editor</p></Link>
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
