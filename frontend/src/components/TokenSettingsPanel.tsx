import { FormEvent, useState } from "react";
import { SlidersHorizontal, Trash, UploadSimple } from "@phosphor-icons/react";
import { assetURL } from "../api/client";
import type { RoomMember, RoomToken, TokenPatch } from "../api/types";
import { damageTypes } from "../lib/actions";
import { PlayerName } from "./PlayerName";

const defenseGroups = [
  { key: "resistances", label: "Resistances" },
  { key: "immunities", label: "Immunities" },
  { key: "vulnerabilities", label: "Vulnerabilities" },
] as const;

type DefenseKey = (typeof defenseGroups)[number]["key"];

type Props = {
  token: RoomToken;
  isDM: boolean;
  canEditImage: boolean;
  members: RoomMember[];
  busy: boolean;
  onSave: (patch: TokenPatch) => void;
  onUploadImage: (file: File) => void;
  onClearImage: () => void;
};

export function TokenSettingsPanel({ token, isDM, canEditImage, members, busy, onSave, onUploadImage, onClearImage }: Props) {
  const [hitPoints, setHitPoints] = useState(token.hit_points === undefined ? "" : String(token.hit_points));
  const [maxHitPoints, setMaxHitPoints] = useState(token.max_hit_points === undefined ? "" : String(token.max_hit_points));
  const [visionRange, setVisionRange] = useState(String(token.vision_range_m));
  const [movers, setMovers] = useState<string[]>(token.mover_user_ids ?? []);
  const [armorClass, setArmorClass] = useState(String(token.defenses?.armor_class ?? ""));
  const [defenses, setDefenses] = useState<Record<DefenseKey, string[]>>({
    resistances: token.defenses?.resistances ?? [],
    immunities: token.defenses?.immunities ?? [],
    vulnerabilities: token.defenses?.vulnerabilities ?? [],
  });
  const [image, setImage] = useState<File | null>(null);
  // The owner and the game master can always move a token; only other players can be granted moves.
  const players = members.filter((member) => !member.is_dm && member.user_id !== token.owner_user_id);
  const headingId = `token-settings-heading-${token.id}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    const patch: TokenPatch = {
      vision_range_m: Number(visionRange),
      // Send only the players listed here, so a mover who left the room does not block the save.
      mover_user_ids: movers.filter((id) => players.some((player) => player.user_id === id)),
      // Kept in the server's damage type order so the stored lists stay tidy.
      resistances: damageTypes.filter((type) => defenses.resistances.includes(type)),
      immunities: damageTypes.filter((type) => defenses.immunities.includes(type)),
      vulnerabilities: damageTypes.filter((type) => defenses.vulnerabilities.includes(type)),
    };
    if (hitPoints.trim() !== "") patch.hit_points = Number(hitPoints);
    if (maxHitPoints.trim() !== "") patch.max_hit_points = Number(maxHitPoints);
    if (armorClass.trim() !== "") patch.armor_class = Number(armorClass);
    onSave(patch);
  }

  return <section className="card space-y-4 p-5!" aria-labelledby={headingId}>
    <h2 id={headingId} className="flex items-center gap-2 text-xl"><SlidersHorizontal size={22} className="text-[var(--accent)]" aria-hidden="true" />Token · {token.name}</h2>
    {canEditImage && <div className="space-y-3">
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
          <input id="token-hit-points" className="w-full" type="number" min={0} max={1000000} step={1} value={hitPoints} onChange={(e) => setHitPoints(e.target.value)} />
        </div>
        <div>
          <label className="field-label block" htmlFor="token-max-hit-points">Max HP</label>
          <input id="token-max-hit-points" className="w-full" type="number" min={0} max={1000000} step={1} value={maxHitPoints} onChange={(e) => setMaxHitPoints(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="field-label block" htmlFor="token-vision-range">Vision radius (m)</label>
        <input id="token-vision-range" className="w-full" type="number" min={0.5} max={1000} step={0.5} required value={visionRange} onChange={(e) => setVisionRange(e.target.value)} />
      </div>
      <div>
        <label className="field-label block" htmlFor="token-armor-class">Armor class</label>
        <input id="token-armor-class" className="w-full" type="number" min={0} max={100} step={1} value={armorClass} onChange={(e) => setArmorClass(e.target.value)} />
      </div>
      {defenseGroups.map((group) => <details key={group.key} className="min-w-0 rounded-lg border border-[var(--line)] p-3">
        <summary className="cursor-pointer text-sm text-[var(--lavender)]">{group.label} ({defenses[group.key].length})</summary>
        <fieldset className="mt-3 grid grid-cols-2 gap-2">
          <legend className="sr-only">{group.label}</legend>
          {damageTypes.map((type) => <label key={type} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={defenses[group.key].includes(type)} onChange={(e) => {
              const checked = e.target.checked;
              setDefenses((current) => ({
                ...current,
                [group.key]: checked ? [...current[group.key], type] : current[group.key].filter((value) => value !== type),
              }));
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
            <input type="checkbox" checked={movers.includes(player.user_id)} onChange={(e) => {
              const checked = e.target.checked;
              setMovers((current) => checked ? [...current, player.user_id] : current.filter((id) => id !== player.user_id));
            }} />
            <PlayerName player={{ id: player.user_id, username: player.username, pronouns: player.pronouns }} />
          </label>)}
      </fieldset>
      <button className="btn w-full" disabled={busy}>{busy ? "Saving…" : "Save token"}</button>
    </form>}
  </section>;
}
