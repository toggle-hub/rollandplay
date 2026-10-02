import { useEffect, useRef } from "react";
import { PencilSimple, Sword, X } from "@phosphor-icons/react";
import type { ResolvedTokenAttack, RoomToken } from "../api/types";
import { attackSummary } from "../lib/attacks";

type Props = {
  x: number;
  y: number;
  token: RoomToken;
  onPreview: (attack: ResolvedTokenAttack) => void;
  onChoose: (attack: ResolvedTokenAttack) => void;
  onEdit?: () => void;
  onClose: () => void;
};

export function TokenAttackMenu({ x, y, token, onPreview, onChoose, onEdit, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const attacks = token.attacks ?? [];

  useEffect(() => {
    const first = menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    (first ?? editButton.current ?? closeButton.current)?.focus({ preventScroll: true });
  }, [x, y, token.id]);

  return <div
    ref={menu}
    className="absolute z-40 max-h-72 w-64 overflow-y-auto rounded-xl border border-[var(--accent)]/35 bg-[var(--input)]/95 p-2 shadow-[0_20px_55px_rgba(0,0,0,0.55)] ring-1 ring-[var(--ink)]/30 backdrop-blur-sm"
    style={{ left: `clamp(0px, ${x + 12}px, calc(100% - 16rem))`, top: `clamp(0px, ${y + 12}px, calc(100% - 12rem))` }}
    role="menu"
    aria-label={`${token.name} attacks`}
    onPointerDown={(event) => event.stopPropagation()}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
        items[next].focus({ preventScroll: true });
      }
    }}
  >
    <div className="mb-1 flex items-center justify-between gap-2 px-2 py-1">
      <p className="mb-0 min-w-0 truncate text-sm font-medium text-[var(--paper)]">{token.name}</p>
      <button ref={closeButton} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--paper)]" type="button" aria-label="Close attack menu" title="Close" onClick={onClose}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
    {attacks.map((attack) => <button
      key={attack.id}
      className="flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-[var(--paper)] hover:border-[var(--accent)] focus-visible:border-[var(--accent)] focus-visible:outline-none"
      type="button"
      role="menuitem"
      onMouseEnter={() => onPreview(attack)}
      onFocus={() => onPreview(attack)}
      onClick={() => onChoose(attack)}
    >
      <Sword size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-sm">{attack.name}</span>
        <span className="block text-xs text-[var(--muted)]">{attackSummary(attack)}</span>
      </span>
    </button>)}
    {attacks.length === 0 && <p className="mb-0 px-2 py-1 text-xs text-[var(--muted)]">
      No attacks yet.{!onEdit && " Ask this character's owner to add attacks."}
    </p>}
    {onEdit && <button ref={editButton} className="btn-secondary mt-2 min-h-9 w-full px-3 py-1.5 text-xs" type="button" onClick={onEdit}>
      <PencilSimple size={14} aria-hidden="true" />Edit attacks
    </button>}
  </div>;
}
