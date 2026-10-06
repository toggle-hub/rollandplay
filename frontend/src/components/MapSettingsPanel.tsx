import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowsOutSimple, Trash, UploadSimple } from "@phosphor-icons/react";
import { assetURL } from "../api/client";
import type { GameMap } from "../api/types";
import { placed } from "../lib/structures";
import { useAssetImage } from "../lib/useAssetImage";
import type { MapFields } from "../lib/useStructureEditor";

type NumberKey = "width_m" | "height_m" | "grid_size_m";

/**
 * A settings input that shows the saved value, keeps what is typed while focused, and saves on Enter or
 * when it loses focus. Escape puts the saved value back.
 */
function SettingField({ id, label, value, number, onCommit }: {
  id: string;
  label: string;
  value: string;
  number?: boolean;
  /** Returns false when the value can't be saved, which puts the saved value back. */
  onCommit: (value: string) => boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = () => {
    if (draft !== value && !onCommit(draft)) setDraft(value);
  };
  return <label className="field-label" htmlFor={id}>
    {label}
    <input
      id={id}
      className="w-full"
      type={number ? "number" : "text"}
      min={number ? "0.1" : undefined}
      step={number ? "any" : undefined}
      value={draft}
      onFocus={() => { focused.current = true; }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
        }
      }}
    />
  </label>;
}

export function MapSettingsPanel({ map, uploading, onSave, onUpload, children }: {
  map: GameMap;
  uploading: boolean;
  onSave: (fields: MapFields, message: string) => void;
  onUpload: (file: File) => void;
  /** More settings below the background, such as deleting the map. */
  children?: ReactNode;
}) {
  const image = useAssetImage(map.background_asset_id);
  const [fit, setFit] = useState<"squares" | "pixels">("squares");
  const [fitValue, setFitValue] = useState("20");
  const fileRef = useRef<HTMLInputElement>(null);
  const grid = Number(map.grid_size_m) || 1;

  const saveNumber = (key: NumberKey, label: string) => (raw: string) => {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) return false;
    onSave({ [key]: value }, `${label} saved.`);
    return true;
  };

  // Pixels of the image per grid square, from either the squares across the image or the pixels per square.
  const fitNumber = Number(fitValue);
  const pixelsPerSquare = image && fitNumber > 0 ? fit === "squares" ? image.naturalWidth / fitNumber : fitNumber : 0;
  const fitted = pixelsPerSquare > 0 && image
    ? { width_m: placed(image.naturalWidth / pixelsPerSquare * grid), height_m: placed(image.naturalHeight / pixelsPerSquare * grid) }
    : null;

  return <section className="card min-w-0 space-y-5" aria-labelledby="map-settings-heading">
    <div>
      <h2 id="map-settings-heading" className="text-2xl">Map settings</h2>
      <p className="text-muted mt-2 text-sm">Changes save when you press Enter or leave a field, and can be undone.</p>
    </div>
    <SettingField id="map-name" label="Map name" value={map.name} onCommit={(raw) => {
      const name = raw.trim();
      if (!name) return false;
      onSave({ name }, "Map name saved.");
      return true;
    }} />
    <div className="grid grid-cols-2 gap-3">
      <SettingField id="map-width" label="Width (meters)" number value={String(Number(map.width_m))} onCommit={saveNumber("width_m", "Map width")} />
      <SettingField id="map-height" label="Height (meters)" number value={String(Number(map.height_m))} onCommit={saveNumber("height_m", "Map height")} />
    </div>
    <SettingField id="map-grid" label="Grid square (meters, 1.5 m = 5 ft)" number value={String(Number(map.grid_size_m))} onCommit={saveNumber("grid_size_m", "Grid size")} />

    <div className="space-y-3 border-t border-[var(--paper)]/10 pt-5">
      <h3 className="field-label">Background image</h3>
      {map.background_asset_id ? <div className="flex items-start gap-3">
        <img src={assetURL(map.background_asset_id)} alt="Current map background" className="h-20 w-28 shrink-0 rounded-md border border-[var(--paper)]/15 object-cover" />
        <div className="grid gap-2">
          <button className="btn-secondary min-h-0 px-3 py-2 text-sm" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}><UploadSimple size={16} aria-hidden="true" />Replace</button>
          <button className="btn-secondary min-h-0 px-3 py-2 text-sm" type="button" disabled={uploading} onClick={() => onSave({ background_asset_id: null }, "Background removed.")}><Trash size={16} aria-hidden="true" />Remove</button>
        </div>
      </div> : <button className="btn-secondary" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}><UploadSimple size={18} aria-hidden="true" />{uploading ? "Uploading…" : "Choose an image"}</button>}
      <input
        ref={fileRef}
        id="map-background"
        aria-label="Background image file"
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onUpload(file);
        }}
      />
      {uploading && map.background_asset_id && <p role="status" className="text-muted text-xs">Uploading…</p>}
      {image && <fieldset className="grid gap-3 rounded-lg border border-[var(--paper)]/10 p-3">
        <legend className="field-label px-1">Size map to image</legend>
        <p className="text-muted text-xs">The image is {image.naturalWidth} × {image.naturalHeight} pixels. Count the grid squares drawn across it, or enter how many pixels one square takes.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="field-label" htmlFor="map-fit-mode">
            Measure by
            <select id="map-fit-mode" className="w-full" value={fit} onChange={(event) => setFit(event.target.value as "squares" | "pixels")}>
              <option value="squares">Squares across</option>
              <option value="pixels">Pixels per square</option>
            </select>
          </label>
          <label className="field-label" htmlFor="map-fit-value">
            {fit === "squares" ? "Squares across" : "Pixels per square"}
            <input id="map-fit-value" className="w-full" type="number" min="1" step="any" value={fitValue} onChange={(event) => setFitValue(event.target.value)} />
          </label>
        </div>
        <button className="btn-secondary" type="button" disabled={!fitted} onClick={() => fitted && onSave(fitted, `Map sized to the image: ${fitted.width_m} × ${fitted.height_m} m.`)}>
          <ArrowsOutSimple size={18} aria-hidden="true" />{fitted ? `Size map to ${fitted.width_m} × ${fitted.height_m} m` : "Size map to image"}
        </button>
      </fieldset>}
    </div>
    {children}
  </section>;
}
