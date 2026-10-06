import { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { altKeyName, shortcutLabel } from "../lib/platform";

const sections: { title: string; rows: [keys: string[], action: string][] }[] = [
  {
    title: "Tools",
    rows: [
      [["v"], "Select and arrange pieces"],
      [["d"], "Draw walls, doors and areas point by point"],
      [["b"], "Stamp ready-made pieces"],
      [["esc"], "Cancel a shape or drag, then back to Select"],
    ],
  },
  {
    title: "Drawing",
    rows: [
      [["enter"], "Finish the shape (or double-click)"],
      [["backspace"], "Remove the last corner"],
      [["alt"], "Hold for free placement, without snapping"],
    ],
  },
  {
    title: "Selection",
    rows: [
      [["left", "right", "up", "down"], "Nudge one grid square"],
      [["shift+left"], "Nudge 0.1 m"],
      [["q", "e"], "Rotate 15°"],
      [["[", "]"], "Shrink or grow 10%"],
      [["del"], "Delete"],
      [["mod+a"], "Select everything"],
      [["mod+c", "mod+v"], "Copy and paste"],
      [["mod+d"], "Duplicate"],
      [["mod+g", "mod+shift+g"], "Group and ungroup"],
    ],
  },
  {
    title: "History and view",
    rows: [
      [["mod+z"], "Undo"],
      [["mod+shift+z"], "Redo"],
      [["space"], "Hold and drag to pan (or drag with the right mouse button)"],
      [["?"], "Show or hide these shortcuts"],
    ],
  },
];

/** The map editor's keyboard and mouse shortcuts, with Cmd or Ctrl to match the user's computer. */
export function EditorShortcutSheet({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    // Captured before the editor's own shortcuts, so Escape only closes the sheet.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="shortcut-sheet-title" className="card max-h-[85vh] w-full max-w-2xl overflow-y-auto">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 id="shortcut-sheet-title" className="text-2xl">Map editor shortcuts</h2>
        <button ref={closeRef} type="button" className="btn-secondary min-h-0 px-2 py-2" aria-label="Close shortcuts" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {sections.map((section) => <section key={section.title}>
          <h3 className="field-label mb-2">{section.title}</h3>
          <dl className="grid gap-1.5 text-sm">
            {section.rows.map(([keys, action]) => <div key={action} className="flex items-start justify-between gap-3">
              <dt className="text-muted">{action}</dt>
              <dd className="flex shrink-0 gap-1">{keys.map((key) => <kbd key={key} className="rounded border border-[var(--paper)]/20 bg-[var(--input)] px-1.5 py-0.5 text-xs text-[var(--paper)]">{key === "alt" ? altKeyName : key === "?" ? "?" : shortcutLabel(key)}</kbd>)}</dd>
            </div>)}
          </dl>
        </section>)}
      </div>
      <p className="text-muted mt-6 text-xs">Moves, resizes and drawn corners snap to grid corners and to nearby wall ends. Scroll to zoom. Right-click a piece for its actions, or empty space to paste.</p>
    </div>
  </div>;
}
