import { useState } from "react";
import { Question, X } from "@phosphor-icons/react";
import { Dialog } from "./Dialog";

type Control = [action: string, how: string];

const everyoneControls: Control[] = [
  ["Move", "Drag a token you control. Hold Shift to snap it to the grid. Walls stop it and it slides along them."],
  ["Move a group", "Drag across empty space to select several tokens, then drag one of them."],
  ["Act", "Right-click your token, press and hold it, or select it and tap Actions (keyboard: Enter) to open its action wheel. Pick an action, click a highlighted target or where an area lands, then press Roll."],
  ["Missed a target?", "While choosing a target, a missed click keeps the action; Esc or Cancel stops it."],
  ["Measure", "Hold the right mouse button and drag. Everyone at the table sees your ruler while you hold it."],
  ["Zoom and pan", "Scroll or pinch to zoom; drag with the middle mouse button, hold Space and drag, or drag with two fingers to pan. Fit shows the whole map."],
  ["Add a token", "Press Add token, then click the map where it should stand. Esc cancels."],
];

const gameMasterControls: Control[] = [
  ["Move the map", "Drag a structure to move it. Drag the round handle above a selected structure to rotate it; hold Shift to snap to 15°."],
  ["Hide or reveal", "Select a token or structure, then choose Hide from players or Reveal to players."],
  ["Build", "In Structures, pick a type and press Place on map, then click the map. These pieces stay in this room and never change the saved map."],
  ["Ask for a roll", "In Checks, pick the check, the DC and who rolls."],
];

/** The '?' button in the room header: a short list of tabletop controls for this player's role. */
export function RoomControlsHelp({ isDM }: { isDM: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn-secondary size-9 min-h-0 shrink-0 p-0" type="button" aria-label="Map controls" title="Map controls" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Question size={18} aria-hidden="true" />
    </button>
    {open && <Dialog name={{ labelledBy: "room-controls-heading" }} onClose={() => setOpen(false)}>
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="room-controls-heading" className="mb-0 text-xl">Map controls</h2>
          <button className="btn-secondary size-9 min-h-0 shrink-0 p-0" type="button" aria-label="Close" onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button>
        </div>
        <ControlList controls={everyoneControls} />
        {isDM && <section className="space-y-3" aria-labelledby="room-controls-gm-heading">
          <h3 id="room-controls-gm-heading" className="mb-0 text-sm font-medium text-[var(--lavender)]">Game master</h3>
          <ControlList controls={gameMasterControls} />
        </section>}
        <p className="text-muted mb-0 text-xs">Esc cancels placing or targeting, and closes this list.</p>
      </div>
    </Dialog>}
  </>;
}

function ControlList({ controls }: { controls: Control[] }) {
  return <dl className="grid gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
    {controls.map(([action, how]) => <div key={action} className="contents">
      <dt className="font-medium text-[var(--paper)]">{action}</dt>
      <dd className="text-muted m-0 mb-1.5 sm:mb-0">{how}</dd>
    </div>)}
  </dl>;
}
