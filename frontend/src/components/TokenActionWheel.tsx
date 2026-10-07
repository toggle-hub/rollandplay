import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { DiceFive, Flask, Heartbeat, MagicWand, PencilSimple, Sword, X, type IconProps } from "@phosphor-icons/react";
import type { RoomToken } from "../api/types";
import { actionSummary, canDeathSave, checkLabel, isDown, type WheelChoice } from "../lib/actions";
import { attackSummary } from "../lib/attacks";
import { quickCheckGroups, type QuickCheckGroup } from "../lib/checks";

type Props = {
  x: number;
  y: number;
  token: RoomToken;
  /** The Checks menu, built from the room's rule book; D&D saving throws, skills and ability checks when absent. */
  checkGroups?: QuickCheckGroup[];
  /** Why attacks, spells and items are off this turn; checks and death saves stay available. */
  turnBlocked?: string;
  onPreview: (rangeM: number | null) => void;
  onChoose: (choice: WheelChoice) => void;
  onEdit?: () => void;
  onClose: () => void;
};

type CategoryKey = "attacks" | "actions" | "items" | "checks" | "death_save" | "edit";
type Category = { key: CategoryKey; label: string; icon: ComponentType<IconProps>; disabled: boolean; title?: string };
type Entry = { key: string; name: string; summary?: string; note?: string; rangeM: number | null; choice: WheelChoice; disabled: boolean };
type EntryGroup = { label?: string; entries: Entry[] };

const wheelRadiusPx = 84;
const wheelCenterPx = 112;
const buttonSizePx = 56;

function stopMenuEvents() {
  return {
    onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    onContextMenu: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

function cycleFocus(container: HTMLElement | null, event: KeyboardEvent, keys: string[]) {
  if (!keys.includes(event.key)) return false;
  event.preventDefault();
  const items = Array.from(container?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  if (items.length === 0) return true;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
  const next = current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
  items[next].focus({ preventScroll: true });
  return true;
}

export function TokenActionWheel({ x, y, token, checkGroups = quickCheckGroups(), turnBlocked, onPreview, onChoose, onEdit, onClose }: Props) {
  const wheel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<CategoryKey | null>(null);
  const attacks = token.attacks ?? [];
  const actions = token.actions ?? [];
  const items = token.items ?? [];
  const dead = !!token.death_saves?.dead;
  const down = isDown(token);
  const blocked = dead ? "This character is dead" : down ? "This character is down" : undefined;
  const actBlocked = blocked ?? turnBlocked;

  const categories: Category[] = [
    { key: "attacks", label: "Attacks", icon: Sword, disabled: !!actBlocked || attacks.length === 0, title: actBlocked ?? (attacks.length === 0 ? "No attacks yet" : undefined) },
    { key: "actions", label: "Spells & abilities", icon: MagicWand, disabled: !!actBlocked || actions.length === 0, title: actBlocked ?? (actions.length === 0 ? "No spells or abilities yet" : undefined) },
    { key: "items", label: "Items", icon: Flask, disabled: !!actBlocked || items.length === 0, title: actBlocked ?? (items.length === 0 ? "No items" : undefined) },
    { key: "checks", label: "Checks", icon: DiceFive, disabled: !!blocked || checkGroups.length === 0, title: blocked ?? (checkGroups.length === 0 ? "This rule book has no numbers to roll checks with" : undefined) },
  ];
  if (canDeathSave(token)) categories.push({ key: "death_save", label: "Death save", icon: Heartbeat, disabled: dead });
  if (onEdit) categories.push({ key: "edit", label: "Edit actions", icon: PencilSimple, disabled: false });

  const openCategory = categories.find((category) => category.key === open);
  const groups: EntryGroup[] = open === "attacks"
    ? [{ entries: attacks.map((attack) => ({ key: attack.id, name: attack.name, summary: attackSummary(attack), rangeM: attack.range_m, choice: { kind: "attack", attack }, disabled: false })) }]
    : open === "actions"
      ? [{
        entries: actions.map((action) => {
          const spent = action.uses?.remaining === 0;
          return { key: action.id, name: action.name, summary: actionSummary(action), note: spent ? "No uses left" : undefined, rangeM: action.range_m, choice: { kind: "action", action }, disabled: spent };
        }),
      }]
      : open === "items"
        ? [{ entries: items.map((item) => ({ key: item.id, name: item.name, summary: actionSummary(item), rangeM: item.range_m, choice: { kind: "item", item }, disabled: false })) }]
        : open === "checks"
          ? checkGroups.map((group) => ({
            label: group.label,
            entries: group.keys.map((key) => {
              const check = { kind: group.kind, key };
              return { key: `${group.kind}:${key}`, name: checkLabel(check), rangeM: null, choice: { kind: "check", check }, disabled: false };
            }),
          }))
          : [];

  useEffect(() => {
    setOpen(null);
    const first = wheel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])');
    (first ?? closeButton.current)?.focus({ preventScroll: true });
  }, [x, y, token.id]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);

  function closeList() {
    const key = open;
    setOpen(null);
    onPreview(null);
    wheel.current?.querySelector<HTMLButtonElement>(`[data-category="${key}"]`)?.focus({ preventScroll: true });
  }

  function pick(category: Category) {
    if (category.disabled) return;
    if (category.key === "death_save") onChoose({ kind: "death_save" });
    else if (category.key === "edit") onEdit?.();
    else setOpen(category.key);
  }

  return <>
    <div
      ref={wheel}
      className="absolute z-40 size-56 rounded-full border border-[var(--accent)]/35 bg-[var(--input)]/95 shadow-[0_20px_55px_rgba(0,0,0,0.55)] ring-1 ring-[var(--ink)]/30 backdrop-blur-sm"
      style={{ left: `clamp(0px, ${x - wheelCenterPx}px, calc(100% - 14rem))`, top: `clamp(0px, ${y - wheelCenterPx}px, calc(100% - 14rem))` }}
      role="menu"
      aria-label={`${token.name} actions`}
      {...stopMenuEvents()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (open) closeList();
          else onClose();
          return;
        }
        cycleFocus(wheel.current, event, ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
      }}
    >
      <div className="absolute left-1/2 top-1/2 flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 text-center">
        <p className="mb-0 w-full truncate text-xs font-medium text-[var(--paper)]">{dead ? "Dead" : token.name}</p>
        {down && !dead && <p className="mb-0 text-[10px] text-[var(--pink)]">Down</p>}
        <button ref={closeButton} className="grid h-6 w-6 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--paper)]" type="button" aria-label="Close action wheel" title="Close" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {categories.map((category, index) => {
        const angle = (-90 + (index * 360) / categories.length) * (Math.PI / 180);
        const Icon = category.icon;
        return <button
          key={category.key}
          data-category={category.key}
          className={`absolute flex size-14 flex-col items-center justify-center gap-0.5 rounded-full border px-1 text-center ${category.disabled
            ? "cursor-not-allowed border-[var(--paper)]/10 text-[var(--muted)] opacity-60"
            : open === category.key
              ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--paper)]"
              : "border-[var(--paper)]/15 text-[var(--paper)] hover:border-[var(--accent)] focus-visible:border-[var(--accent)] focus-visible:outline-none"}`}
          style={{
            left: `${wheelCenterPx + wheelRadiusPx * Math.cos(angle) - buttonSizePx / 2}px`,
            top: `${wheelCenterPx + wheelRadiusPx * Math.sin(angle) - buttonSizePx / 2}px`,
          }}
          type="button"
          role="menuitem"
          aria-disabled={category.disabled ? "true" : undefined}
          aria-haspopup={category.key === "death_save" || category.key === "edit" ? undefined : "menu"}
          aria-expanded={category.key === "death_save" || category.key === "edit" ? undefined : open === category.key}
          title={category.title}
          onClick={() => pick(category)}
        >
          <Icon size={18} className={category.disabled ? "" : "text-[var(--accent)]"} aria-hidden="true" />
          <span className="text-[10px] leading-tight">{category.label}</span>
        </button>;
      })}
    </div>
    {openCategory && <div
      ref={list}
      className="absolute z-40 max-h-72 w-64 overflow-y-auto rounded-xl border border-[var(--accent)]/35 bg-[var(--input)]/95 p-2 shadow-[0_20px_55px_rgba(0,0,0,0.55)] ring-1 ring-[var(--ink)]/30 backdrop-blur-sm"
      style={{ left: `clamp(0px, ${x + 124}px, calc(100% - 16rem))`, top: `clamp(0px, ${y - 112}px, calc(100% - 18rem))` }}
      role="menu"
      aria-label={`${token.name} ${openCategory.label}`}
      {...stopMenuEvents()}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeList();
          return;
        }
        cycleFocus(list.current, event, ["ArrowUp", "ArrowDown"]);
      }}
    >
      {groups.map((group, index) => <div key={group.label ?? index} role="group" aria-label={group.label}>
        {group.label && <p className="field-label mb-0 px-2 pb-1 pt-2">{group.label}</p>}
        {group.entries.map((entry) => <button
          key={entry.key}
          className={`flex w-full items-start gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left focus-visible:outline-none ${entry.disabled
            ? "cursor-not-allowed text-[var(--muted)]"
            : "text-[var(--paper)] hover:border-[var(--accent)] focus-visible:border-[var(--accent)]"}`}
          type="button"
          role="menuitem"
          aria-disabled={entry.disabled ? "true" : undefined}
          onMouseEnter={() => onPreview(entry.rangeM)}
          onFocus={() => onPreview(entry.rangeM)}
          onClick={() => {
            if (!entry.disabled) onChoose(entry.choice);
          }}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm">{entry.name}</span>
            {entry.summary && <span className="block text-xs text-[var(--muted)]">{entry.summary}</span>}
            {entry.note && <span className="block text-xs text-[var(--pink)]">{entry.note}</span>}
          </span>
        </button>)}
      </div>)}
    </div>}
  </>;
}
