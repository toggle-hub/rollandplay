import { FormEvent, KeyboardEvent, useState } from "react";
import { ArrowCounterClockwise, Flask, MagicWand, Plus, Sword, Trash } from "@phosphor-icons/react";
import type { ActionKind, ActionLists, TokenAction, TokenAttack, TokenItem } from "../api/types";
import { compendiumSummary, damageTypes, rollPreview, type RollPreviewInput } from "../lib/actions";
import { diceExpressionPattern, dndAbilities } from "../lib/attacks";
import { humanizeKey } from "../lib/checks";

type Limits = { attacks: number; actions: number; items: number };

type Props = {
  owner: { id: string; name: string; attacks?: TokenAttack[]; actions?: TokenAction[]; items?: TokenItem[] };
  /** Entries offered by "Add from compendium"; no picker without it. */
  compendium?: ActionLists;
  limits?: Limits;
  /** The owner's stats; with them the editor works out to-hit bonuses and save DCs, without them it names the formula. */
  stats?: Record<string, unknown>;
  /** Renders without its own form, so it can sit inside another form; Save then applies the lists to that form's draft. */
  embedded?: boolean;
  saveLabel?: string;
  busy: boolean;
  onSave: (lists: ActionLists) => void;
  onClose: () => void;
};

// Same caps as the server's character lists (Go `MaxAttacks`, `MaxActions`, `MaxItems`).
const characterLimits: Limits = { attacks: 20, actions: 30, items: 50 };

const actionKinds: { value: ActionKind; label: string }[] = [
  { value: "attack", label: "Attack roll" },
  { value: "save", label: "Saving throw" },
  { value: "heal", label: "Healing" },
];

/** Number fields stay as typed text until submit so partial input like "-" can be edited. */
type DraftAttack = Omit<TokenAttack, "range_m" | "attack_bonus" | "damage_bonus"> & {
  range_m: string;
  attack_bonus: string;
  damage_bonus: string;
};

type DraftEffect = Omit<TokenAction, "range_m" | "area_radius_m" | "bonus" | "dice_bonus" | "uses"> & {
  range_m: string;
  area_radius_m: string;
  bonus: string;
  dice_bonus: string;
};

type DraftAction = DraftEffect & { limited: boolean; uses_max: string; uses_remaining: string };

type DraftItem = DraftEffect & { quantity: string };

function draftAttack(a: TokenAttack): DraftAttack {
  return {
    id: a.id,
    name: a.name,
    range_m: String(a.range_m),
    ability: a.ability,
    proficient: a.proficient,
    attack_bonus: String(a.attack_bonus),
    damage: a.damage,
    damage_bonus: String(a.damage_bonus),
    damage_type: a.damage_type,
  };
}

function draftEffect(a: Omit<TokenAction, "uses">): DraftEffect {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    range_m: String(a.range_m),
    area_radius_m: String(a.area_radius_m),
    ability: a.ability,
    proficient: a.proficient,
    bonus: String(a.bonus),
    save_ability: a.save_ability,
    half_on_save: a.half_on_save,
    dice: a.dice,
    dice_bonus: String(a.dice_bonus),
    ability_to_dice: a.ability_to_dice,
    damage_type: a.damage_type,
  };
}

function draftAction(a: TokenAction): DraftAction {
  return { ...draftEffect(a), limited: !!a.uses, uses_max: String(a.uses?.max ?? 1), uses_remaining: String(a.uses?.remaining ?? 1) };
}

function draftItem(i: TokenItem): DraftItem {
  return { ...draftEffect(i), quantity: String(i.quantity) };
}

function newAction(): DraftAction {
  return {
    id: crypto.randomUUID(), name: "", kind: "heal", range_m: "1.5", area_radius_m: "0", ability: "wisdom", proficient: false, bonus: "0",
    save_ability: "", half_on_save: false, dice: "1d8", dice_bonus: "0", ability_to_dice: true, damage_type: "",
    limited: false, uses_max: "1", uses_remaining: "1",
  };
}

function newItem(): DraftItem {
  return {
    id: crypto.randomUUID(), name: "Potion of healing", kind: "heal", range_m: "1.5", area_radius_m: "0", ability: "", proficient: false, bonus: "0",
    save_ability: "", half_on_save: false, dice: "2d4", dice_bonus: "2", ability_to_dice: false, damage_type: "", quantity: "1",
  };
}

/** A blank field counts as 0, like the server's zero value. */
function wholeNumber(text: string): number {
  return text.trim() ? Number(text) : 0;
}

/** A half-typed number previews as 0. */
function previewNumber(text: string): number {
  const n = wholeNumber(text);
  return Number.isFinite(n) ? n : 0;
}

function attackPreview(row: DraftAttack): RollPreviewInput {
  return { kind: "attack", ability: row.ability, proficient: row.proficient, bonus: previewNumber(row.attack_bonus), dice: row.damage, diceBonus: previewNumber(row.damage_bonus), abilityToDice: true, damageType: row.damage_type };
}

function effectPreview(row: DraftEffect): RollPreviewInput {
  return { kind: row.kind, ability: row.ability, proficient: row.proficient, bonus: row.kind === "heal" ? 0 : previewNumber(row.bonus), dice: row.dice, diceBonus: previewNumber(row.dice_bonus), abilityToDice: row.ability_to_dice, damageType: row.damage_type };
}

function RollPreview({ input, stats }: { input: RollPreviewInput; stats?: Record<string, unknown> }) {
  return <p className="mb-0 rounded-lg bg-[var(--input)]/40 px-3 py-2 text-xs text-[var(--lavender)]">{rollPreview(input, stats).join(" · ")}</p>;
}

function inRange(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

function withStored(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [...options, value] : options;
}

/** Mirrors the server's `validateAction`; fields hidden for the row's kind are sent as their empty values. */
function parseEffect(row: DraftEffect, fallbackName: string): Omit<TokenAction, "uses"> | string {
  const name = row.name.trim();
  if (!name) return `${fallbackName} needs a name.`;
  if ([...name].length > 80) return `${name} name must be at most 80 characters.`;
  const rangeM = Number(row.range_m);
  if (!row.range_m.trim() || !(rangeM > 0 && rangeM <= 1000)) return `${name} range must be more than 0 and at most 1000 meters.`;
  const areaRadiusM = row.kind === "attack" ? 0 : Number(row.area_radius_m.trim() || "0");
  if (!(areaRadiusM >= 0 && areaRadiusM <= 100)) return `${name} area radius must be from 0 to 100 meters.`;
  const ability = row.ability.trim();
  if (ability.length > 64) return `${name} ability name is too long.`;
  const bonus = row.kind === "heal" ? 0 : wholeNumber(row.bonus);
  const diceBonus = wholeNumber(row.dice_bonus);
  if (!inRange(bonus, -100, 100) || !inRange(diceBonus, -100, 100)) return `${name} bonuses must be whole numbers between -100 and 100.`;
  const saveAbility = row.kind === "save" ? row.save_ability.trim() : "";
  if (row.kind === "save" && !dndAbilities.includes(saveAbility)) return `${name} save ability must be one of ${dndAbilities.join(", ")}.`;
  const dice = row.dice.replace(/\s+/g, "");
  if (!diceExpressionPattern.test(dice)) return `${name} needs ${row.kind === "heal" ? "healing" : "damage"} dice such as 1d8+2.`;
  const damageType = row.kind === "heal" ? "" : row.damage_type;
  if (damageType && !damageTypes.includes(damageType)) return `${name} damage type must be one of ${damageTypes.join(", ")}.`;
  return {
    id: row.id, name, kind: row.kind, range_m: rangeM, area_radius_m: areaRadiusM, ability, proficient: row.proficient, bonus,
    save_ability: saveAbility, half_on_save: row.kind === "save" && row.half_on_save, dice, dice_bonus: diceBonus,
    ability_to_dice: row.ability_to_dice, damage_type: damageType,
  };
}

export function ActionsEditor({ owner, compendium, limits = characterLimits, stats, embedded = false, saveLabel = "Save actions", busy, onSave, onClose }: Props) {
  const [attacks, setAttacks] = useState<DraftAttack[]>(() => (owner.attacks ?? []).map(draftAttack));
  const [actions, setActions] = useState<DraftAction[]>(() => (owner.actions ?? []).map(draftAction));
  const [items, setItems] = useState<DraftItem[]>(() => (owner.items ?? []).map(draftItem));
  const [error, setError] = useState("");
  const headingId = `actions-heading-${owner.id}`;

  function updateAttack(index: number, patch: Partial<DraftAttack>) {
    setAttacks((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }
  function updateAction(index: number, patch: Partial<DraftAction>) {
    setActions((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }
  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function validate(): ActionLists | string {
    if (attacks.length > limits.attacks) return `This list can have at most ${limits.attacks} attacks.`;
    if (actions.length > limits.actions) return `This list can have at most ${limits.actions} spells and abilities.`;
    if (items.length > limits.items) return `This list can have at most ${limits.items} items.`;
    const lists: ActionLists = { attacks: [], actions: [], items: [] };
    for (const [index, row] of attacks.entries()) {
      const name = row.name.trim();
      if (!name) return `Attack ${index + 1} needs a name.`;
      if ([...name].length > 80) return `${name} name must be at most 80 characters.`;
      const rangeM = Number(row.range_m);
      if (!row.range_m.trim() || !(rangeM > 0 && rangeM <= 1000)) return `${name} range must be more than 0 and at most 1000 meters.`;
      const ability = row.ability.trim();
      if (ability.length > 64) return `${name} ability name is too long.`;
      const attackBonus = wholeNumber(row.attack_bonus);
      const damageBonus = wholeNumber(row.damage_bonus);
      if (!inRange(attackBonus, -100, 100) || !inRange(damageBonus, -100, 100)) return `${name} bonuses must be whole numbers between -100 and 100.`;
      const damage = row.damage.replace(/\s+/g, "");
      if (!diceExpressionPattern.test(damage)) return `${name} damage must be a dice expression such as 1d8+2.`;
      if (row.damage_type && !damageTypes.includes(row.damage_type)) return `${name} damage type must be one of ${damageTypes.join(", ")}.`;
      lists.attacks.push({ id: row.id, name, range_m: rangeM, ability, proficient: row.proficient, attack_bonus: attackBonus, damage, damage_bonus: damageBonus, damage_type: row.damage_type });
    }
    for (const [index, row] of actions.entries()) {
      const action = parseEffect(row, `Spell or ability ${index + 1}`);
      if (typeof action === "string") return action;
      let uses: TokenAction["uses"] = null;
      if (row.limited) {
        const max = wholeNumber(row.uses_max);
        const remaining = wholeNumber(row.uses_remaining);
        if (!inRange(max, 1, 100)) return `${action.name} uses must be a whole number from 1 to 100.`;
        if (!inRange(remaining, 0, max)) return `${action.name} uses left must be a whole number from 0 to ${max}.`;
        uses = { max, remaining };
      }
      lists.actions.push({ ...action, uses });
    }
    for (const [index, row] of items.entries()) {
      const item = parseEffect(row, `Item ${index + 1}`);
      if (typeof item === "string") return item;
      const quantity = Number(row.quantity);
      if (!row.quantity.trim() || !inRange(quantity, 1, 999)) return `${item.name} quantity must be a whole number from 1 to 999.`;
      lists.items.push({ ...item, quantity });
    }
    return lists;
  }

  function apply() {
    const lists = validate();
    if (typeof lists === "string") return setError(lists);
    setError("");
    onSave(lists);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    apply();
  }

  /** Inside another form, Enter in a field applies these lists instead of submitting that form. */
  function applyOnEnter(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    apply();
  }

  const Shell = embedded ? "div" : "form";
  return <Shell className="card space-y-4 p-5!" role={embedded ? "group" : undefined} onSubmit={embedded ? undefined : submit} onKeyDown={embedded ? applyOnEnter : undefined} aria-labelledby={headingId}>
    <h2 id={headingId} className="text-xl">Actions · {owner.name}</h2>

    <section className="space-y-4" aria-labelledby={`${headingId}-attacks`}>
      <h3 id={`${headingId}-attacks`} className="flex items-center gap-2 text-lg"><Sword size={20} className="text-[var(--accent)]" aria-hidden="true" />Attacks</h3>
      {attacks.length === 0 && <p className="text-muted text-sm">No attacks yet. Add one to roll it from the map.</p>}
      {attacks.map((row, index) => {
        const id = `attack-${row.id}`;
        return <fieldset key={row.id} className="min-w-0 space-y-3 border-t border-[var(--line)] pt-4">
          <legend className="sr-only">{row.name || `Attack ${index + 1}`}</legend>
          <div>
            <label className="field-label block" htmlFor={`${id}-name`}>Name</label>
            <input id={`${id}-name`} className="w-full" value={row.name} onChange={(e) => updateAttack(index, { name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label block" htmlFor={`${id}-range`}>Range (m)</label>
              <input id={`${id}-range`} className="w-full" type="number" step={0.5} min={0.5} value={row.range_m} onChange={(e) => updateAttack(index, { range_m: e.target.value })} />
            </div>
            <div>
              <label className="field-label block" htmlFor={`${id}-ability`}>Ability modifier</label>
              <select id={`${id}-ability`} className="w-full min-w-0" value={row.ability} onChange={(e) => updateAttack(index, { ability: e.target.value })}>
                <option value="">None</option>
                {withStored(dndAbilities, row.ability).map((ability) => <option key={ability} value={ability}>{humanizeKey(ability)}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={row.proficient} onChange={(e) => updateAttack(index, { proficient: e.target.checked })} />Add proficiency bonus</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label block" htmlFor={`${id}-attack-bonus`}>Attack bonus</label>
              <input id={`${id}-attack-bonus`} className="w-full" type="number" step={1} value={row.attack_bonus} onChange={(e) => updateAttack(index, { attack_bonus: e.target.value })} />
            </div>
            <div>
              <label className="field-label block" htmlFor={`${id}-damage`}>Damage dice</label>
              <input id={`${id}-damage`} className="w-full" placeholder="1d8" value={row.damage} onChange={(e) => updateAttack(index, { damage: e.target.value })} />
            </div>
            <div>
              <label className="field-label block" htmlFor={`${id}-damage-bonus`}>Damage bonus</label>
              <input id={`${id}-damage-bonus`} className="w-full" type="number" step={1} value={row.damage_bonus} onChange={(e) => updateAttack(index, { damage_bonus: e.target.value })} />
            </div>
            <DamageTypeSelect id={`${id}-damage-type`} value={row.damage_type} onChange={(damage_type) => updateAttack(index, { damage_type })} />
          </div>
          <RollPreview input={attackPreview(row)} stats={stats} />
          <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => setAttacks((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>
            <Trash size={14} aria-hidden="true" />Remove {row.name || "attack"}
          </button>
        </fieldset>;
      })}
      {compendium && <CompendiumPicker label="Compendium weapon" entries={compendium.attacks} taken={attacks} disabled={attacks.length >= limits.attacks}
        onAdd={(entry) => setAttacks((rows) => [...rows, draftAttack(entry)])} />}
      <button className="btn-secondary w-full" type="button" disabled={attacks.length >= limits.attacks} onClick={() => setAttacks((rows) => [...rows, {
        id: crypto.randomUUID(),
        name: "",
        range_m: "1.5",
        ability: "strength",
        proficient: true,
        attack_bonus: "0",
        damage: "1d6",
        damage_bonus: "0",
        damage_type: "",
      }])}>
        <Plus size={16} aria-hidden="true" />Add attack
      </button>
    </section>

    <section className="space-y-4 border-t border-[var(--line)] pt-4" aria-labelledby={`${headingId}-actions`}>
      <h3 id={`${headingId}-actions`} className="flex items-center gap-2 text-lg"><MagicWand size={20} className="text-[var(--accent)]" aria-hidden="true" />Spells & abilities</h3>
      {actions.length === 0 && <p className="text-muted text-sm">No spells or abilities yet. Add healing, a fireball or any other effect.</p>}
      {actions.map((row, index) => {
        const id = `action-${row.id}`;
        return <fieldset key={row.id} className="min-w-0 space-y-3 border-t border-[var(--line)] pt-4">
          <legend className="sr-only">{row.name || `Spell or ability ${index + 1}`}</legend>
          <EffectFields id={id} row={row} stats={stats} onChange={(patch) => updateAction(index, patch)} />
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={row.limited} onChange={(e) => updateAction(index, { limited: e.target.checked })} />Limited uses</label>
          {row.limited && <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label block" htmlFor={`${id}-uses-max`}>Uses</label>
              <input id={`${id}-uses-max`} className="w-full" type="number" step={1} min={1} max={100} value={row.uses_max} onChange={(e) => updateAction(index, { uses_max: e.target.value })} />
            </div>
            <div>
              <label className="field-label block" htmlFor={`${id}-uses-remaining`}>Uses left</label>
              <input id={`${id}-uses-remaining`} className="w-full" type="number" step={1} min={0} max={100} value={row.uses_remaining} onChange={(e) => updateAction(index, { uses_remaining: e.target.value })} />
            </div>
          </div>}
          <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => setActions((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>
            <Trash size={14} aria-hidden="true" />Remove {row.name || "spell or ability"}
          </button>
        </fieldset>;
      })}
      {compendium && <CompendiumPicker label="Compendium spell or ability" entries={compendium.actions} taken={actions} disabled={actions.length >= limits.actions}
        onAdd={(entry) => setActions((rows) => [...rows, draftAction(entry)])} />}
      <div className="flex flex-wrap gap-3">
        <button className="btn-secondary flex-1" type="button" disabled={actions.length >= limits.actions} onClick={() => setActions((rows) => [...rows, newAction()])}>
          <Plus size={16} aria-hidden="true" />Add spell or ability
        </button>
        <button className="btn-secondary flex-1" type="button" disabled={!actions.some((row) => row.limited)}
          onClick={() => setActions((rows) => rows.map((row) => row.limited ? { ...row, uses_remaining: row.uses_max } : row))}>
          <ArrowCounterClockwise size={16} aria-hidden="true" />Restore all uses
        </button>
      </div>
    </section>

    <section className="space-y-4 border-t border-[var(--line)] pt-4" aria-labelledby={`${headingId}-items`}>
      <h3 id={`${headingId}-items`} className="flex items-center gap-2 text-lg"><Flask size={20} className="text-[var(--accent)]" aria-hidden="true" />Items</h3>
      {items.length === 0 && <p className="text-muted text-sm">No items yet. Potions and scrolls are used up one at a time.</p>}
      {items.map((row, index) => {
        const id = `item-${row.id}`;
        return <fieldset key={row.id} className="min-w-0 space-y-3 border-t border-[var(--line)] pt-4">
          <legend className="sr-only">{row.name || `Item ${index + 1}`}</legend>
          <EffectFields id={id} row={row} stats={stats} onChange={(patch) => updateItem(index, patch)} />
          <div>
            <label className="field-label block" htmlFor={`${id}-quantity`}>Quantity</label>
            <input id={`${id}-quantity`} className="w-full" type="number" step={1} min={1} max={999} value={row.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} />
          </div>
          <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={() => setItems((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>
            <Trash size={14} aria-hidden="true" />Remove {row.name || "item"}
          </button>
        </fieldset>;
      })}
      {compendium && <CompendiumPicker label="Compendium item" entries={compendium.items} taken={items} disabled={items.length >= limits.items}
        onAdd={(entry) => setItems((rows) => [...rows, draftItem(entry)])} />}
      <button className="btn-secondary w-full" type="button" disabled={items.length >= limits.items} onClick={() => setItems((rows) => [...rows, newItem()])}>
        <Plus size={16} aria-hidden="true" />Add item
      </button>
    </section>

    {error && <p role="alert" className="mb-0 text-sm text-[var(--pink)]">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button className="btn" type={embedded ? "button" : "submit"} onClick={embedded ? apply : undefined} disabled={busy}>{busy ? "Saving…" : saveLabel}</button>
      <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
    </div>
  </Shell>;
}

/** "Add from compendium": offers the entries not already in the list. */
function CompendiumPicker<T extends TokenAttack | TokenAction | TokenItem>({ label, entries, taken, disabled, onAdd }: {
  label: string;
  entries: T[];
  taken: { id: string }[];
  disabled: boolean;
  onAdd: (entry: T) => void;
}) {
  const [selected, setSelected] = useState("");
  const available = entries.filter((entry) => !taken.some((row) => row.id === entry.id));
  const entry = available.find((item) => item.id === selected);
  return <div className="flex flex-wrap items-end gap-3">
    <label className="field-label min-w-0 flex-1">Add from compendium
      <select aria-label={label} className="w-full min-w-0" value={entry ? selected : ""} onChange={(e) => setSelected(e.target.value)}>
        <option value=""></option>
        {available.map((item) => <option key={item.id} value={item.id}>{`${item.name} — ${compendiumSummary(item)}`}</option>)}
      </select>
    </label>
    <button className="btn-secondary" type="button" aria-label={`Add ${label.toLowerCase()}`} disabled={!entry || disabled} onClick={() => {
      if (!entry) return;
      onAdd(entry);
      setSelected("");
    }}>Add</button>
  </div>;
}

function DamageTypeSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return <div>
    <label className="field-label block" htmlFor={id}>Damage type</label>
    <select id={id} className="w-full min-w-0" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">None</option>
      {withStored(damageTypes, value).map((type) => <option key={type} value={type}>{type}</option>)}
    </select>
  </div>;
}

/** The fields spells, abilities and items share; uses and quantity are added by the caller. */
function EffectFields({ id, row, stats, onChange }: { id: string; row: DraftEffect; stats?: Record<string, unknown>; onChange: (patch: Partial<DraftEffect>) => void }) {
  const heal = row.kind === "heal";
  return <>
    <div>
      <label className="field-label block" htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} className="w-full" value={row.name} onChange={(e) => onChange({ name: e.target.value })} />
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="field-label block" htmlFor={`${id}-kind`}>Kind</label>
        <select id={`${id}-kind`} className="w-full min-w-0" value={row.kind} onChange={(e) => {
          const kind = e.target.value as ActionKind;
          onChange(kind === "save" && !row.save_ability ? { kind, save_ability: "dexterity" } : { kind });
        }}>
          {actionKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
        </select>
      </div>
      <div>
        <label className="field-label block" htmlFor={`${id}-range`}>Range (m)</label>
        <input id={`${id}-range`} className="w-full" type="number" step={0.5} min={0.5} value={row.range_m} onChange={(e) => onChange({ range_m: e.target.value })} />
      </div>
      {row.kind !== "attack" && <div className="col-span-2">
        <label className="field-label block" htmlFor={`${id}-area`}>Area radius (m)</label>
        <input id={`${id}-area`} className="w-full" type="number" step={0.5} min={0} max={100} aria-describedby={`${id}-area-hint`}
          value={row.area_radius_m} onChange={(e) => onChange({ area_radius_m: e.target.value })} />
        <p id={`${id}-area-hint`} className="text-muted mb-0 mt-1 text-xs">0 targets one creature.</p>
      </div>}
      <div>
        <label className="field-label block" htmlFor={`${id}-ability`}>Ability modifier</label>
        <select id={`${id}-ability`} className="w-full min-w-0" value={row.ability} onChange={(e) => onChange({ ability: e.target.value })}>
          <option value="">None</option>
          {withStored(dndAbilities, row.ability).map((ability) => <option key={ability} value={ability}>{humanizeKey(ability)}</option>)}
        </select>
      </div>
      {!heal && <div>
        <label className="field-label block" htmlFor={`${id}-bonus`}>{row.kind === "save" ? "DC bonus" : "Attack bonus"}</label>
        <input id={`${id}-bonus`} className="w-full" type="number" step={1} value={row.bonus} onChange={(e) => onChange({ bonus: e.target.value })} />
      </div>}
    </div>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={row.proficient} onChange={(e) => onChange({ proficient: e.target.checked })} />Add proficiency bonus</label>
    {row.kind === "save" && <>
      <div>
        <label className="field-label block" htmlFor={`${id}-save-ability`}>Saving throw</label>
        <select id={`${id}-save-ability`} className="w-full min-w-0" value={row.save_ability} onChange={(e) => onChange({ save_ability: e.target.value })}>
          <option value="">Choose an ability</option>
          {dndAbilities.map((ability) => <option key={ability} value={ability}>{humanizeKey(ability)}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={row.half_on_save} onChange={(e) => onChange({ half_on_save: e.target.checked })} />Half damage on a successful save</label>
    </>}
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="field-label block" htmlFor={`${id}-dice`}>{heal ? "Healing dice" : "Damage dice"}</label>
        <input id={`${id}-dice`} className="w-full" placeholder="1d8" value={row.dice} onChange={(e) => onChange({ dice: e.target.value })} />
      </div>
      <div>
        <label className="field-label block" htmlFor={`${id}-dice-bonus`}>{heal ? "Healing bonus" : "Damage bonus"}</label>
        <input id={`${id}-dice-bonus`} className="w-full" type="number" step={1} value={row.dice_bonus} onChange={(e) => onChange({ dice_bonus: e.target.value })} />
      </div>
      {!heal && <DamageTypeSelect id={`${id}-damage-type`} value={row.damage_type} onChange={(damage_type) => onChange({ damage_type })} />}
    </div>
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={row.ability_to_dice} onChange={(e) => onChange({ ability_to_dice: e.target.checked })} />Add ability modifier to dice</label>
    <RollPreview input={effectPreview(row)} stats={stats} />
  </>;
}
