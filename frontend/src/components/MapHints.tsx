import { useState } from "react";

const dismissedKey = "rollandplay.mapHintsDismissed";

const mouseHints = ["Right-click your token to act", "Right-drag to measure", "Scroll to zoom", "Space + drag or middle-drag to pan"];
const touchHints = ["Press and hold your token to act", "Pinch to zoom", "Drag with two fingers to pan"];

/** A dismissible strip over the map naming the core controls; once dismissed it stays hidden on this browser. */
export function MapHints() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissedKey) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  function dismiss() {
    try {
      localStorage.setItem(dismissedKey, "1");
    } catch {
      // Storage is off; the tips stay hidden until the page reloads.
    }
    setDismissed(true);
  }

  return <div role="note" aria-label="Map controls tips" className="absolute bottom-3 left-3 z-20 max-w-[calc(100%-13rem)] rounded-lg border border-[var(--paper)]/10 bg-[var(--input)]/90 px-3 py-2 text-xs text-[var(--paper)] shadow-xl">
    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
      {(coarse ? touchHints : mouseHints).map((hint) => <li key={hint}>{hint}</li>)}
    </ul>
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
      <p className="text-muted mb-0">More under Controls in the room header.</p>
      <button className="btn-secondary min-h-7! px-2! py-0.5! text-xs!" type="button" onClick={dismiss}>Got it</button>
    </div>
  </div>;
}
