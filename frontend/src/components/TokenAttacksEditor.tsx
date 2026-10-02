import { FormEvent, useState } from "react";
import { Plus, Sword, Trash } from "@phosphor-icons/react";
import type { RoomToken, TokenAttack } from "../api/types";
import { diceExpressionPattern, dndAbilities } from "../lib/attacks";

type Props = {
  token: RoomToken;
  busy: boolean;
  onSave: (attacks: TokenAttack[]) => void;
  onClose: () => void;
};

const maxAttacks = 20;

/** Number fields stay as typed text until submit so partial input like "-" can be edited. */
type DraftAttack = Omit<TokenAttack, "range_m" | "attack_bonus" | "damage_bonus"> & {
  range_m: string;
  attack_bonus: string;
  damage_bonus: string;
};

export function TokenAttacksEditor({ token, busy, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<DraftAttack[]>(() => (token.attacks ?? []).map((attack) => ({
    id: attack.id,
    name: attack.name,
    range_m: String(attack.range_m),
    ability: attack.ability,
    proficient: attack.proficient,
    attack_bonus: String(attack.attack_bonus),
    damage: attack.damage,
    damage_bonus: String(attack.damage_bonus),
  })));
  const [error, setError] = useState("");

  function updateRow(index: number, patch: Partial<DraftAttack>) {
    setDraft((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const attacks: TokenAttack[] = [];
    for (const [index, row] of draft.entries()) {
      const name = row.name.trim();
      if (!name) return setError(`Attack ${index + 1} needs a name.`);
      const rangeM = Number(row.range_m);
      if (!row.range_m.trim() || !(rangeM > 0 && rangeM <= 1000)) return setError(`${name} range must be more than 0 and at most 1000 meters.`);
      const attackBonus = row.attack_bonus.trim() ? Number(row.attack_bonus) : 0;
      const damageBonus = row.damage_bonus.trim() ? Number(row.damage_bonus) : 0;
      if (![attackBonus, damageBonus].every((bonus) => Number.isInteger(bonus) && Math.abs(bonus) <= 100)) {
        return setError(`${name} bonuses must be whole numbers between -100 and 100.`);
      }
      const damage = row.damage.replace(/\s+/g, "");
      if (!diceExpressionPattern.test(damage)) return setError(`${name} damage must be a dice expression such as 1d8+2.`);
      attacks.push({ id: row.id, name, range_m: rangeM, ability: row.ability.trim(), proficient: row.proficient, attack_bonus: attackBonus, damage, damage_bonus: damageBonus });
    }
    setError("");
    onSave(attacks);
  }

  return <form className="card space-y-4 p-5!" onSubmit={submit} aria-labelledby={`attacks-heading-${token.id}`}>
    <h2 id={`attacks-heading-${token.id}`} className="flex items-center gap-2 text-xl"><Sword size={22} className="text-[var(--accent)]" aria-hidden="true" />Attacks · {token.name}</h2>
    {draft.length === 0 && <p className="text-muted text-sm">No attacks yet. Add one to roll it from the map.</p>}
    {draft.map((row, index) => {
      const id = `attack-${row.id}`;
      const abilityOptions = row.ability && !dndAbilities.includes(row.ability) ? [...dndAbilities, row.ability] : dndAbilities;
      return <fieldset key={row.id} className="min-w-0 space-y-3 border-t border-[var(--line)] pt-4">
        <legend className="sr-only">{row.name || `Attack ${index + 1}`}</legend>
        <div>
          <label className="field-label block" htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} className="w-full" value={row.name} onChange={(e) => updateRow(index, { name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label block" htmlFor={`${id}-range`}>Range (m)</label>
            <input id={`${id}-range`} className="w-full" type="number" step={0.5} min={0.5} value={row.range_m} onChange={(e) => updateRow(index, { range_m: e.target.value })} />
          </div>
          <div>
            <label className="field-label block" htmlFor={`${id}-ability`}>Ability modifier</label>
            <select id={`${id}-ability`} className="w-full min-w-0" value={row.ability} onChange={(e) => updateRow(index, { ability: e.target.value })}>
              <option value="">None</option>
              {abilityOptions.map((ability) => <option key={ability} value={ability}>{ability}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={row.proficient} onChange={(e) => updateRow(index, { proficient: e.target.checked })} />Add proficiency bonus</label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label block" htmlFor={`${id}-attack-bonus`}>Attack bonus</label>
            <input id={`${id}-attack-bonus`} className="w-full" type="number" step={1} value={row.attack_bonus} onChange={(e) => updateRow(index, { attack_bonus: e.target.value })} />
          </div>
          <div>
            <label className="field-label block" htmlFor={`${id}-damage`}>Damage dice</label>
            <input id={`${id}-damage`} className="w-full" placeholder="1d8" value={row.damage} onChange={(e) => updateRow(index, { damage: e.target.value })} />
          </div>
          <div>
            <label className="field-label block" htmlFor={`${id}-damage-bonus`}>Damage bonus</label>
            <input id={`${id}-damage-bonus`} className="w-full" type="number" step={1} value={row.damage_bonus} onChange={(e) => updateRow(index, { damage_bonus: e.target.value })} />
          </div>
        </div>
        <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => setDraft((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>
          <Trash size={14} aria-hidden="true" />Remove {row.name || "attack"}
        </button>
      </fieldset>;
    })}
    <button className="btn-secondary w-full" type="button" disabled={draft.length >= maxAttacks} onClick={() => setDraft((rows) => [...rows, {
      id: crypto.randomUUID(),
      name: "",
      range_m: "1.5",
      ability: "strength",
      proficient: true,
      attack_bonus: "0",
      damage: "1d6",
      damage_bonus: "0",
    }])}>
      <Plus size={16} aria-hidden="true" />Add attack
    </button>
    {error && <p role="alert" className="mb-0 text-sm text-[var(--pink)]">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save attacks"}</button>
      <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
    </div>
  </form>;
}
