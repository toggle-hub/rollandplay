import { useState } from "react";
import { Plus, Sword, Trash } from "@phosphor-icons/react";
import type { ActionLists } from "../api/types";
import { hasCompendium } from "../lib/actions";
import { draftStats, newMonsterDraft, type MonsterDraft } from "../lib/monsters";
import { ActionsEditor } from "./ActionsEditor";
import { AttributeFields } from "./AttributeFields";

/** `bookAttributes` seeds a new monster's stats with the book's current values; `compendium` feeds "Add from compendium". */
type Props = { drafts: MonsterDraft[]; bookAttributes: Record<string, unknown>; compendium: ActionLists; onChange: (drafts: MonsterDraft[]) => void };

/** Monster templates game masters can place in rooms that use this rule book. */
export function MonstersEditor({ drafts, bookAttributes, compendium, onChange }: Props) {
  const [editingLists, setEditingLists] = useState("");
  function update(key: string, changes: Partial<MonsterDraft>) {
    onChange(drafts.map((draft) => draft.key === key ? { ...draft, ...changes } : draft));
  }
  return <section className="min-w-0 space-y-4 border-t border-[var(--line)] pt-5" aria-labelledby="monsters-heading">
    <h3 id="monsters-heading" className="mb-0 text-lg">Monsters ({drafts.length})</h3>
    <p className="text-muted text-sm">Stat blocks game masters can place at the table. Each placed monster gets its own copy of these stats, attacks and abilities.</p>
    {drafts.map((draft, index) => {
      const name = draft.name || `New monster ${index + 1}`;
      const moves = [...draft.lists.attacks, ...draft.lists.actions, ...draft.lists.items].map((entry) => entry.name);
      return <details className="min-w-0 rounded-lg border border-[var(--line)] p-3" key={draft.key}>
        <summary className="cursor-pointer text-[var(--lavender)]">{name}</summary>
        <div className="mt-4 min-w-0 space-y-4">
          <label className="field-label">Monster name<input value={draft.name} maxLength={80} onChange={(e) => update(draft.key, { name: e.target.value })} /></label>
          <label className="field-label">Description <span className="text-muted font-normal">(optional)</span><textarea className="w-full" maxLength={1000} value={draft.description} onChange={(e) => update(draft.key, { description: e.target.value })} /></label>
          <label className="field-label">Token size (m)<input type="number" min="0.1" max="30" step="0.1" value={draft.size} onChange={(e) => update(draft.key, { size: e.target.value })} /></label>
          <h4 className="mb-0 text-base">Stats</h4>
          <AttributeFields fields={draft.stats} onChange={(stats) => update(draft.key, { stats })} />
          <div className="min-w-0 space-y-3 rounded-lg border border-[var(--line)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="mb-0 text-base">Attacks & abilities</h4>
              <button type="button" className="btn-secondary" aria-expanded={editingLists === draft.key} onClick={() => setEditingLists((open) => open === draft.key ? "" : draft.key)}>
                <Sword size={18} aria-hidden="true" />{editingLists === draft.key ? "Close" : `Edit ${name}'s attacks & abilities`}
              </button>
            </div>
            <p className="text-muted mb-0 text-xs">{draft.lists.attacks.length} attacks · {draft.lists.actions.length} spells and abilities · {draft.lists.items.length} items</p>
            {moves.length > 0 && <p className="mb-0 text-sm">{moves.join(", ")}</p>}
            {editingLists === draft.key && <ActionsEditor owner={{ id: `monster-${draft.key}`, name, ...draft.lists }} compendium={hasCompendium(compendium) ? compendium : undefined} stats={draftStats(draft)} embedded saveLabel="Apply to monster" busy={false}
              onSave={(lists) => { update(draft.key, { lists }); setEditingLists(""); }} onClose={() => setEditingLists("")} />}
          </div>
          <button type="button" className="btn-secondary" onClick={() => onChange(drafts.filter((item) => item.key !== draft.key))}><Trash size={18} aria-hidden="true" />Remove monster</button>
        </div>
      </details>;
    })}
    <button type="button" className="btn-secondary" onClick={() => onChange([...drafts, newMonsterDraft(bookAttributes)])}><Plus size={18} aria-hidden="true" />Add monster</button>
  </section>;
}
