import { useEffect, useState } from "react";
import { assetURL } from "../api/client";

/** Loads an uploaded image; returns it once it has loaded, and null before that or without an id. */
export function useAssetImage(assetId: string | null | undefined): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ id: string; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setLoaded({ id: assetId, image });
    };
    image.src = assetURL(assetId);
    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, [assetId]);
  return loaded && loaded.id === assetId ? loaded.image : null;
}
