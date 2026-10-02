import { FormEvent, useState } from "react";
import { DiceFive } from "@phosphor-icons/react";
import type { CheckKind, RoomMember } from "../api/types";
import { attributeKeyPattern, checkKeyOptions, checkKinds, defaultCheckKey, humanizeKey } from "../lib/checks";
import { PlayerName } from "./PlayerName";

export type CheckPromptRequest = {
  title: string;
  kind: CheckKind;
  key: string;
  dc: number;
  targetUserIds: string[];
  isPrivate: boolean;
};

type Props = {
  members: RoomMember[];
  /** Sends the prompt; returns false when it could not be sent so the form keeps its input. */
  onPrompt: (request: CheckPromptRequest) => boolean;
};

/** Game-master form: ask players with a character at this table to roll a check, optionally as a named encounter. */
export function CheckPromptForm({ members, onPrompt }: Props) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CheckKind>("skill");
  const [key, setKey] = useState(defaultCheckKey("skill"));
  const [dc, setDc] = useState("10");
  const [targets, setTargets] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const withCharacter = members.filter((member) => member.sheet_id);
  const options = checkKeyOptions(kind);
  const allSelected = withCharacter.length > 0 && withCharacter.every((member) => targets.includes(member.user_id));

  function submit(e: FormEvent) {
    e.preventDefault();
    const request = { title: title.trim(), kind, key: key.trim(), dc: Number(dc), targetUserIds: targets.filter((id) => withCharacter.some((member) => member.user_id === id)), isPrivate };
    if (!request.key || !request.targetUserIds.length) return;
    if (onPrompt(request)) {
      setTitle("");
      setTargets([]);
    }
  }

  return <form className="card space-y-3 p-5!" onSubmit={submit} aria-labelledby="check-prompt-heading">
    <h2 id="check-prompt-heading" className="flex items-center gap-2 text-xl"><DiceFive size={22} className="text-[var(--accent)]" aria-hidden="true" />Prompt a check</h2>
    <p className="text-muted text-sm">Players roll 1d20 plus their character's modifier. Meeting the DC is a success.</p>
    <label className="field-label block" htmlFor="check-title">Encounter name <span className="text-muted font-normal">(optional)</span></label>
    <input id="check-title" className="w-full" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goblin ambush" />
    <label className="field-label block" htmlFor="check-kind">Check</label>
    <select id="check-kind" className="w-full min-w-0" value={kind} onChange={(e) => {
      const next = e.target.value as CheckKind;
      setKind(next);
      setKey(defaultCheckKey(next));
    }}>
      {checkKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    <label className="field-label block" htmlFor="check-key">{kind === "skill" ? "Skill" : kind === "attribute" ? "Sheet attribute" : "Ability"}</label>
    {kind === "attribute"
      ? <input id="check-key" className="w-full font-mono" required pattern={attributeKeyPattern} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sanity" aria-describedby="check-key-hint" />
      : <select id="check-key" className="w-full min-w-0" value={key} onChange={(e) => setKey(e.target.value)}>
        {options.map((option) => <option key={option} value={option}>{humanizeKey(option)}</option>)}
      </select>}
    {kind === "attribute" && <p id="check-key-hint" className="text-muted text-xs">A number on the character sheet, added to the roll as-is. Lowercase key, e.g. <span className="font-mono">speed_m</span>.</p>}
    <label className="field-label block" htmlFor="check-dc">Difficulty class (DC)</label>
    <input id="check-dc" className="w-full" type="number" min="1" max="100" step="1" required value={dc} onChange={(e) => setDc(e.target.value)} />
    <fieldset className="space-y-2">
      <legend className="field-label">Who rolls</legend>
      {withCharacter.length === 0
        ? <p className="text-muted text-sm">No one at this table has a character assigned yet.</p>
        : <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allSelected} onChange={(e) => setTargets(e.target.checked ? withCharacter.map((member) => member.user_id) : [])} />Everyone with a character</label>
          {withCharacter.map((member) => <label className="flex items-start gap-2 text-sm" key={member.user_id}>
            <input className="mt-1 shrink-0" type="checkbox" checked={targets.includes(member.user_id)} onChange={(e) => setTargets((current) => e.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} />
            <PlayerName className="min-w-0 break-words" player={{ id: member.user_id, username: member.username, pronouns: member.pronouns }} />
          </label>)}
        </>}
    </fieldset>
    <fieldset className="space-y-2">
      <legend className="field-label">Results</legend>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="check-visibility" checked={!isPrivate} onChange={() => setIsPrivate(false)} />Public: the whole table sees every result</label>
      <label className="flex items-center gap-2 text-sm"><input type="radio" name="check-visibility" checked={isPrivate} onChange={() => setIsPrivate(true)} />Private: each player sees only their own</label>
    </fieldset>
    <button className="btn w-full" disabled={!targets.length || !key.trim()}>Ask for the roll</button>
  </form>;
}
