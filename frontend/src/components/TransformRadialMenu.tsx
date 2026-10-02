import { useEffect, useRef } from "react";
import { ArrowClockwise, ArrowsOutCardinal, X } from "@phosphor-icons/react";

export type TransformMode = "move" | "rotate";

type Props = {
  x: number;
  y: number;
  label: string;
  mode: TransformMode;
  onModeChange: (mode: TransformMode) => void;
  onClose: () => void;
};

export function TransformRadialMenu({ x, y, label, mode, onModeChange, onClose }: Props) {
  const moveButton = useRef<HTMLButtonElement>(null);
  const rotateButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (mode === "move" ? moveButton : rotateButton).current?.focus({ preventScroll: true });
  }, [x, y, mode]);

  return <div
    className="absolute z-40 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--accent)]/35 bg-[var(--input)]/95 shadow-[0_20px_55px_rgba(0,0,0,0.55)] ring-1 ring-[var(--ink)]/30 backdrop-blur-sm"
    style={{ left: `clamp(88px, ${x}px, calc(100% - 88px))`, top: `clamp(88px, ${y}px, calc(100% - 88px))` }}
    role="menu"
    aria-label={`${label} transform wheel`}
    onPointerDown={(event) => event.stopPropagation()}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? moveButton : event.key === "End" ? rotateButton
          : document.activeElement === moveButton.current ? rotateButton : moveButton;
        next.current?.focus({ preventScroll: true });
      }
    }}
  >
    <button ref={moveButton} className="absolute inset-x-2 top-2 flex h-[74px] flex-col items-center justify-center gap-1 rounded-t-full border border-[var(--paper)]/15 bg-[var(--surface-raised)] pb-3 text-xs text-[var(--paper)] hover:border-[var(--accent)] aria-checked:border-[var(--accent)] aria-checked:bg-[var(--accent)] aria-checked:text-[var(--ink)]" type="button" role="menuitemradio" aria-checked={mode === "move"} aria-label="Move mode" onClick={() => onModeChange("move")}>
      <ArrowsOutCardinal size={22} aria-hidden="true" /><span>Move</span>
    </button>
    <button ref={rotateButton} className="absolute inset-x-2 bottom-2 flex h-[74px] flex-col items-center justify-center gap-1 rounded-b-full border border-[var(--paper)]/15 bg-[var(--surface-raised)] pt-3 text-xs text-[var(--paper)] hover:border-[var(--accent)] aria-checked:border-[var(--accent)] aria-checked:bg-[var(--accent)] aria-checked:text-[var(--ink)]" type="button" role="menuitemradio" aria-checked={mode === "rotate"} aria-label="Rotate mode" onClick={() => onModeChange("rotate")}>
      <ArrowClockwise size={22} aria-hidden="true" /><span>Rotate</span>
    </button>
    <button className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--accent)]/45 bg-[var(--ink)] text-[var(--muted)] hover:text-[var(--paper)]" type="button" aria-label="Close transform wheel" title="Close" onClick={onClose}>
      <X size={15} aria-hidden="true" />
    </button>
  </div>;
}
