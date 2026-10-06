import { X } from "@phosphor-icons/react";
import type { ActionLists, TokenAction, TokenAttack, TokenItem } from "../api/types";
import { compendiumSummary } from "../lib/actions";

export type ListKey = keyof ActionLists;
export type Entry = TokenAttack | TokenAction | TokenItem;
type Group = { key: ListKey; label: string; sections: { label: string; entries: Entry[] }[] };

const actionKinds: { kind: TokenAction["kind"]; label: string }[] = [
  { kind: "attack", label: "Attack rolls" },
  { kind: "save", label: "Saving throws" },
  { kind: "heal", label: "Healing" },
];

/** Weapons split into melee (reach up to 3 m) and ranged or thrown; spells by how they resolve. */
function groups(compendium: ActionLists, spellList?: string[]): Group[] {
  const spells = spellList ? compendium.actions.filter((entry) => spellList.includes(entry.id)) : compendium.actions;
  return [
    { key: "attacks" as const, label: "Weapons", sections: [
      { label: "Melee", entries: compendium.attacks.filter((entry) => entry.range_m <= 3) },
      { label: "Ranged & thrown", entries: compendium.attacks.filter((entry) => entry.range_m > 3) },
    ] },
    { key: "actions" as const, label: "Spells & abilities", sections: actionKinds.map(({ kind, label }) => ({ label, entries: spells.filter((entry) => entry.kind === kind) })) },
    { key: "items" as const, label: "Items", sections: [{ label: "", entries: compendium.items }] },
  ].map((group) => ({ ...group, sections: group.sections.filter((section) => section.entries.length > 0) })).filter((group) => group.sections.length > 0);
}

type Props = {
  compendium: ActionLists;
  picks: ActionLists;
  /** The chosen class's spell list; absent offers every compendium spell. */
  spellList?: string[];
  className?: string;
  onToggle: (key: ListKey, entry: Entry, checked: boolean) => void;
};

export function EquipmentPicker({ compendium, picks, spellList, className, onToggle }: Props) {
  const picked = (["attacks", "actions", "items"] as const).flatMap((key) => (picks[key] as Entry[]).map((entry) => ({ key, entry })));
  const visible = groups(compendium, spellList);
  return <div className="min-w-0 space-y-4">
    <div className="space-y-2" aria-live="polite">
      <h4 className="mb-0 text-sm text-[var(--lavender)]">Picked ({picked.length})</h4>
      {picked.length === 0 ? <p className="text-muted mb-0 text-sm">Nothing picked yet.</p> : <ul className="flex flex-wrap gap-2">
        {picked.map(({ key, entry }) => <li key={`${key}:${entry.id}`} className="flex items-center gap-1 rounded-full border border-[var(--line)] py-1 pl-3 pr-1 text-sm">
          {entry.name}
          <button type="button" className="rounded-full p-1 text-[var(--lavender)] hover:text-[var(--paper)]" aria-label={`Remove ${entry.name}`} onClick={() => onToggle(key, entry, false)}><X size={14} aria-hidden="true" /></button>
        </li>)}
      </ul>}
    </div>
    {spellList?.length === 0 && compendium.actions.length > 0 && <p className="text-muted text-sm">{className ? `${className} characters don’t` : "This class doesn’t"} cast spells from this rule book, so no spells are listed.</p>}
    {visible.map((group) => {
      const count = (picks[group.key] as Entry[]).length;
      const total = group.sections.reduce((sum, section) => sum + section.entries.length, 0);
      return <details key={group.key} className="min-w-0 rounded-lg border border-[var(--line)] p-3">
        <summary className="cursor-pointer text-[var(--lavender)]">{group.label} <span className="text-muted text-xs">· {count} picked · {total} to choose from</span></summary>
        <div className="mt-3 space-y-4">{group.sections.map((section) => <fieldset key={section.label} className="min-w-0 space-y-2">
          {section.label && <legend className="field-label">{section.label}</legend>}
          <div className="grid gap-2 sm:grid-cols-2">{section.entries.map((entry) => <label key={entry.id} className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1" checked={(picks[group.key] as Entry[]).some((item) => item.id === entry.id)} onChange={(e) => onToggle(group.key, entry, e.target.checked)} />
            <span className="min-w-0">{entry.name}<span className="text-muted block text-xs">{compendiumSummary(entry)}</span></span>
          </label>)}</div>
        </fieldset>)}</div>
      </details>;
    })}
  </div>;
}
