import { FormEvent, useState } from "react";
import { Bed, Heart, SlidersHorizontal, Sword, Trash, UploadSimple } from "@phosphor-icons/react";
import { assetURL } from "../api/client";
import type { RoomMember, RoomToken, TokenPatch } from "../api/types";
import { damageTypes } from "../lib/actions";
import { sameMembers, useSyncedField } from "../lib/useSyncedField";
import { ConditionsEditor } from "./ConditionsEditor";
import { PlayerName } from "./PlayerName";

const defenseGroups = [
  { key: "resistances", label: "Resistances" },
  { key: "immunities", label: "Immunities" },
  { key: "vulnerabilities", label: "Vulnerabilities" },
] as const;

type Props = {
  token: RoomToken;
  isDM: boolean;
  /** The token's owner or the game master: its image and conditions. */
  canManage: boolean;
  members: RoomMember[];
  busy: boolean;
  onSave: (patch: TokenPatch) => void;
  onUploadImage: (file: File) => void;
  onClearImage: () => void;
  /** Sends a room websocket message (quick damage and healing, long rest). */
  onSend: (type: string, body: unknown) => boolean;
};

const numberText = (value: number | null | undefined) => value === undefined || value === null ? "" : String(value);

export function TokenSettingsPanel({ token, isDM, canManage, members, busy, onSave, onUploadImage, onClearImage, onSend }: Props) {
  // Every field follows the server until the game master edits it, and a save sends only
  // edited fields, so a damage roll that lands while this card is open is never undone.
  const hitPoints = useSyncedField(numberText(token.hit_points));
  const maxHitPoints = useSyncedField(numberText(token.max_hit_points));
  const tempHitPoints = useSyncedField(numberText(token.temporary_hit_points));
  const armorClass = useSyncedField(numberText(token.defenses?.armor_class));
  const visionRange = useSyncedField(String(token.vision_range_m));
  const movers = useSyncedField(token.mover_user_ids ?? [], sameMembers);
  const defenses = {
    resistances: useSyncedField(token.defenses?.resistances ?? [], sameMembers),
    immunities: useSyncedField(token.defenses?.immunities ?? [], sameMembers),
    vulnerabilities: useSyncedField(token.defenses?.vulnerabilities ?? [], sameMembers),
  };
  const saveSuccesses = useSyncedField(token.death_saves?.successes ?? 0);
  const saveFailures = useSyncedField(token.death_saves?.failures ?? 0);
  const stable = useSyncedField(token.death_saves?.stable ?? false);
  const [image, setImage] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [confirmRest, setConfirmRest] = useState(false);
  // The owner and the game master can always move a token; only other players can be granted moves.
  const players = members.filter((member) => !member.is_dm && member.user_id !== token.owner_user_id);
  const headingId = `token-settings-heading-${token.id}`;
  const changed = [hitPoints, maxHitPoints, tempHitPoints, armorClass, visionRange, movers, defenses.resistances, defenses.immunities,
    defenses.vulnerabilities, saveSuccesses, saveFailures, stable].some((field) => field.dirty);
  const quickAmount = Number(amount);
  const canAdjust = token.hit_points !== undefined && Number.isInteger(quickAmount) && quickAmount >= 1 && quickAmount <= 1000000;

  function submit(event: FormEvent) {
    event.preventDefault();
    const patch: TokenPatch = {};
    if (hitPoints.dirty && hitPoints.value.trim() !== "") patch.hit_points = Number(hitPoints.value);
    if (maxHitPoints.dirty && maxHitPoints.value.trim() !== "") patch.max_hit_points = Number(maxHitPoints.value);
    if (tempHitPoints.dirty && tempHitPoints.value.trim() !== "") patch.temporary_hit_points = Number(tempHitPoints.value);
    if (armorClass.dirty && armorClass.value.trim() !== "") patch.armor_class = Number(armorClass.value);
    if (visionRange.dirty) patch.vision_range_m = Number(visionRange.value);
    // Send only the players listed here, so a mover who left the room does not block the save.
    if (movers.dirty) patch.mover_user_ids = movers.value.filter((id) => players.some((player) => player.user_id === id));
    for (const group of defenseGroups) {
      // Kept in the server's damage type order so the stored lists stay tidy.
      if (defenses[group.key].dirty) patch[group.key] = damageTypes.filter((type) => defenses[group.key].value.includes(type));
    }
    if (saveSuccesses.dirty) patch.death_save_successes = saveSuccesses.value;
    if (saveFailures.dirty) patch.death_save_failures = saveFailures.value;
    if (stable.dirty) patch.stable = stable.value;
    if (Object.keys(patch).length > 0) onSave(patch);
  }

  function adjust(kind: "damage" | "heal") {
    if (!canAdjust) return;
    if (onSend("token.health", { tokenId: token.id, [kind]: quickAmount })) setAmount("");
  }

  return <section className="card space-y-4 p-5!" aria-labelledby={headingId}>
    <h2 id={headingId} className="flex items-center gap-2 text-xl"><SlidersHorizontal size={22} className="text-[var(--accent)]" aria-hidden="true" />Token · {token.name}</h2>
    {isDM && <div className="space-y-2" role="group" aria-labelledby={`${headingId}-quick`}>
      <p id={`${headingId}-quick`} className="field-label">Quick damage or healing</p>
      {token.hit_points === undefined
        ? <p className="text-muted text-sm">Set Current HP below to use quick damage and healing.</p>
        : <>
          <p className="text-sm">HP <span className="font-medium tabular-nums">{token.hit_points}{token.max_hit_points !== undefined ? ` / ${token.max_hit_points}` : ""}</span>
            {!!token.temporary_hit_points && <span className="text-muted ml-2">+{token.temporary_hit_points} temporary</span>}</p>
          <label className="sr-only" htmlFor={`token-quick-amount-${token.id}`}>Amount</label>
          <input id={`token-quick-amount-${token.id}`} className="w-full" type="number" min={1} max={1000000} step={1} inputMode="numeric" placeholder="Amount"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary min-h-0 gap-2 px-3 py-2" type="button" disabled={!canAdjust} onClick={() => adjust("damage")}><Sword size={16} aria-hidden="true" />Damage</button>
            <button className="btn-secondary min-h-0 gap-2 px-3 py-2" type="button" disabled={!canAdjust} onClick={() => adjust("heal")}><Heart size={16} aria-hidden="true" />Heal</button>
          </div>
          <p className="text-muted text-xs">Damage uses temporary HP first, like a hit. Healing stops at max HP.</p>
        </>}
    </div>}
    {canManage && <ConditionsEditor tokenId={token.id} conditions={token.conditions ?? []} busy={busy} onChange={(conditions) => onSave({ conditions })} />}
    {canManage && <div className="space-y-3 border-t border-[var(--line)] pt-4">
      {token.image_asset_id && <img src={assetURL(token.image_asset_id)} alt="" className="size-16 rounded-full object-cover" />}
      <label className="field-label block" htmlFor="token-image">Token image</label>
      <input id="token-image" type="file" accept="image/*" className="w-full max-w-full text-sm" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" type="button" disabled={!image || busy} onClick={() => image && onUploadImage(image)}><UploadSimple size={18} aria-hidden="true" />Upload image</button>
        {token.image_asset_id && <button className="btn-secondary" type="button" disabled={busy} onClick={onClearImage}><Trash size={18} aria-hidden="true" />Remove image</button>}
      </div>
    </div>}
    {isDM && <form className="space-y-3 border-t border-[var(--line)] pt-4" onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label block" htmlFor="token-hit-points">Current HP</label>
          <input id="token-hit-points" className="w-full" type="number" min={0} max={1000000} step={1} value={hitPoints.value} onChange={(e) => hitPoints.set(e.target.value)} />
        </div>
        <div>
          <label className="field-label block" htmlFor="token-max-hit-points">Max HP</label>
          <input id="token-max-hit-points" className="w-full" type="number" min={0} max={1000000} step={1} value={maxHitPoints.value} onChange={(e) => maxHitPoints.set(e.target.value)} />
        </div>
        <div>
          <label className="field-label block" htmlFor="token-temp-hit-points">Temp HP</label>
          <input id="token-temp-hit-points" className="w-full" type="number" min={0} max={1000000} step={1} value={tempHitPoints.value} onChange={(e) => tempHitPoints.set(e.target.value)} />
        </div>
        <div>
          <label className="field-label block" htmlFor="token-armor-class">Armor class</label>
          <input id="token-armor-class" className="w-full" type="number" min={0} max={100} step={1} value={armorClass.value} onChange={(e) => armorClass.set(e.target.value)} />
        </div>
      </div>
      {token.death_saves && <fieldset className="space-y-2">
        <legend className="field-label">Death saves</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-muted block text-xs" htmlFor="token-save-successes">Successes</label>
            <select id="token-save-successes" className="w-full" value={saveSuccesses.value} onChange={(e) => saveSuccesses.set(Number(e.target.value))}>
              {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </div>
          <div>
            <label className="text-muted block text-xs" htmlFor="token-save-failures">Failures</label>
            <select id="token-save-failures" className="w-full" value={saveFailures.value} onChange={(e) => saveFailures.set(Number(e.target.value))}>
              {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count === 3 ? "3 (dead)" : count}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stable.value} onChange={(e) => stable.set(e.target.checked)} />Stable</label>
      </fieldset>}
      <div>
        <label className="field-label block" htmlFor="token-vision-range">Vision radius (m)</label>
        <input id="token-vision-range" className="w-full" type="number" min={0.5} max={1000} step={0.5} required value={visionRange.value} onChange={(e) => visionRange.set(e.target.value)} />
      </div>
      {defenseGroups.map((group) => <details key={group.key} className="min-w-0 rounded-lg border border-[var(--line)] p-3">
        <summary className="cursor-pointer text-sm text-[var(--lavender)]">{group.label} ({defenses[group.key].value.length})</summary>
        <fieldset className="mt-3 grid grid-cols-2 gap-2">
          <legend className="sr-only">{group.label}</legend>
          {damageTypes.map((type) => <label key={type} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={defenses[group.key].value.includes(type)} onChange={(e) => {
              const checked = e.target.checked;
              defenses[group.key].set((current) => checked ? [...current, type] : current.filter((value) => value !== type));
            }} />
            {type}
          </label>)}
        </fieldset>
      </details>)}
      <fieldset className="space-y-2">
        <legend className="field-label">Can also move this token</legend>
        {players.length === 0
          ? <p className="text-muted text-sm">No other players at this table.</p>
          : players.map((player) => <label key={player.user_id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={movers.value.includes(player.user_id)} onChange={(e) => {
              const checked = e.target.checked;
              movers.set((current) => checked ? [...current, player.user_id] : current.filter((id) => id !== player.user_id));
            }} />
            <PlayerName player={{ id: player.user_id, username: player.username, pronouns: player.pronouns }} />
          </label>)}
      </fieldset>
      <button className="btn w-full" disabled={busy || !changed}>{busy ? "Saving…" : changed ? "Save changes" : "No changes to save"}</button>
    </form>}
    {isDM && <div className="space-y-2 border-t border-[var(--line)] pt-4">
      <button className="btn-secondary w-full" type="button" onClick={() => {
        if (!confirmRest) {
          setConfirmRest(true);
          return;
        }
        if (onSend("token.rest", { tokenIds: [token.id] })) setConfirmRest(false);
      }} onBlur={() => setConfirmRest(false)}><Bed size={18} aria-hidden="true" />{confirmRest ? "Confirm long rest" : "Long rest"}</button>
      <p className="text-muted text-xs">Restores max HP, clears temporary HP and death saves, and refills limited uses.</p>
    </div>}
  </section>;
}
