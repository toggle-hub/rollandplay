import { useEffect, useMemo, useState } from "react";

export type LayerFlag = "locked" | "hidden";
type StoredFlags = Record<LayerFlag, string[]>;

const emptyFlags: StoredFlags = { locked: [], hidden: [] };

function readFlags(key: string): StoredFlags {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (!parsed || typeof parsed !== "object") return emptyFlags;
    const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    return { locked: ids((parsed as StoredFlags).locked), hidden: ids((parsed as StoredFlags).hidden) };
  } catch {
    return emptyFlags;
  }
}

/**
 * Editor-only lock and hide toggles for a map's structures. They change nothing for players and are
 * remembered in this browser per map.
 */
export function useLayerFlags(mapId: string | undefined) {
  const key = `rollandplay.map-editor.layers.${mapId ?? ""}`;
  const [flags, setFlags] = useState<StoredFlags>(() => readFlags(key));
  useEffect(() => setFlags(readFlags(key)), [key]);

  function toggle(flag: LayerFlag, id: string) {
    const current = new Set(flags[flag]);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    const next = { ...flags, [flag]: [...current] };
    setFlags(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the toggle still applies for this visit.
    }
  }

  const locked = useMemo(() => new Set(flags.locked), [flags.locked]);
  const hidden = useMemo(() => new Set(flags.hidden), [flags.hidden]);
  return { locked, hidden, toggle };
}
