import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, EyeSlash, Plus, SkipForward, StopCircle, Sword, X } from "@phosphor-icons/react";
import type { Combat, RoomToken } from "../api/types";
import { useToast } from "./Toast";

type Props = {
  combat: Combat | null | undefined;
  /** Tokens on the active map the viewer can see; game masters see hidden ones too. */
  tokens: RoomToken[];
  isDM: boolean;
  currentUserId?: string;
  /** Sends a combat websocket message; false when it could not be sent. */
  onSend: (type: string, body: unknown) => boolean;
};

// ".btn" is unlayered CSS, so the compact sizing needs important utilities.
const smallButton = "min-h-8! shrink-0 gap-1.5! px-3! py-1! text-xs!";

/**
 * The fight's turn order above the map: whose turn it is, the round, and the game master's
 * controls. Players get a "Your turn" notice when one of their characters is up.
 */
export function TurnOrderStrip({ combat, tokens, isDM, currentUserId, onSend }: Props) {
  const toast = useToast();
  const [picking, setPicking] = useState<"start" | "add" | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const current = combat?.combatants.find((combatant) => combatant.id === combat.current_combatant_id);
  const myTurn = !!current && !isDM && current.player_user_id === currentUserId;
  const announced = useRef("");

  useEffect(() => {
    if (!myTurn || !combat || !current) return;
    const key = `${combat.round}:${current.id}`;
    if (announced.current === key) return;
    announced.current = key;
    toast({ kind: "info", message: `Your turn: ${current.name} (round ${combat.round}).` });
  }, [myTurn, combat?.round, current?.id]);

  useEffect(() => {
    setConfirmEnd(false);
    if (!combat) setPicking((mode) => (mode === "add" ? null : mode));
    else setPicking((mode) => (mode === "start" ? null : mode));
  }, [!!combat]);

  if (!combat && !isDM) return null;

  const inFight = new Set(combat?.combatants.map((combatant) => combatant.token_id));
  const candidates = picking === "add" ? tokens.filter((token) => !inFight.has(token.id)) : tokens;

  function openPicker(mode: "start" | "add") {
    setPicking(mode);
    // Starting a fight picks every visible token; adding starts from none.
    setPicked(mode === "start" ? tokens.filter((token) => !token.is_hidden).map((token) => token.id) : []);
  }

  function submitPicker() {
    if (picked.length === 0 || !picking) return;
    if (onSend(picking === "start" ? "combat.start" : "combat.add", { tokenIds: picked })) setPicking(null);
  }

  const picker = picking && <div className="space-y-2 rounded-lg border border-[var(--paper)]/10 bg-[var(--surface)]/60 p-3" role="group" aria-label={picking === "start" ? "Choose who fights" : "Add to the fight"}>
    <p className="mb-0 text-xs text-[var(--muted)]">{picking === "start" ? "Choose the tokens that roll initiative (1d20 plus initiative bonus or Dexterity modifier)." : "Choose tokens to join the fight. They roll initiative and take their place in the order."}</p>
    {candidates.length === 0
      ? <p className="mb-0 text-xs text-[var(--muted)]">{picking === "start" ? "Place tokens on the map first." : "Every token on the map is already in the fight."}</p>
      : <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {candidates.map((token) => <label key={token.id} className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={picked.includes(token.id)} onChange={(event) => setPicked((current) => event.target.checked ? [...current, token.id] : current.filter((id) => id !== token.id))} />
          {token.name}{token.is_hidden && <span className="text-xs text-[var(--muted)]">(hidden)</span>}
        </label>)}
      </div>}
    <div className="flex flex-wrap justify-end gap-2">
      <button className={`btn-secondary ${smallButton}`} type="button" onClick={() => setPicking(null)}>Cancel</button>
      <button className={`btn ${smallButton}`} type="button" disabled={picked.length === 0} onClick={submitPicker}>{picking === "start" ? `Roll initiative (${picked.length})` : `Add to fight (${picked.length})`}</button>
    </div>
  </div>;

  if (!combat) {
    return <section className="space-y-2" aria-label="Combat">
      {!picking && <button className={`btn-secondary ${smallButton}`} type="button" onClick={() => openPicker("start")}><Sword size={16} aria-hidden="true" />Start combat</button>}
      {picker}
    </section>;
  }

  return <section className={`space-y-2 rounded-lg border px-3 py-2 ${myTurn ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--paper)]/10 bg-[var(--input)]"}`} aria-label="Turn order">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="mb-0 flex items-center gap-2 text-sm font-medium">
        <Sword size={18} className="text-[var(--accent)]" aria-hidden="true" />Round {combat.round}
        {myTurn
          ? <strong role="status" className="rounded-md bg-[var(--accent)] px-2 py-0.5 text-xs text-[var(--ink)]">Your turn</strong>
          : <span className="text-xs font-normal text-[var(--muted)]">{current ? `${current.name}'s turn` : "Waiting for the game master"}</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {myTurn && <button className={`btn ${smallButton}`} type="button" onClick={() => onSend("combat.next", { combatantId: current.id })}><SkipForward size={16} aria-hidden="true" />End my turn</button>}
        {isDM && <>
          <button className={`btn ${smallButton}`} type="button" disabled={!current} onClick={() => current && onSend("combat.next", { combatantId: current.id })}><SkipForward size={16} aria-hidden="true" />Next turn</button>
          <button className={`btn-secondary ${smallButton}`} type="button" onClick={() => openPicker("add")}><Plus size={16} aria-hidden="true" />Add</button>
          <button className={`btn-secondary ${smallButton}`} type="button" onClick={() => {
            if (!confirmEnd) {
              setConfirmEnd(true);
              return;
            }
            onSend("combat.end", {});
          }}><StopCircle size={16} aria-hidden="true" />{confirmEnd ? "Confirm end combat" : "End combat"}</button>
        </>}
      </div>
    </div>
    {combat.combatants.length === 0
      ? <p className="mb-0 text-xs text-[var(--muted)]">Nobody is in the turn order.{isDM ? " Add tokens to continue." : ""}</p>
      : <ol className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1" aria-label="Initiative order">
        {combat.combatants.map((combatant, index) => {
          const isCurrent = combatant.id === current?.id;
          const mine = !isDM && combatant.player_user_id === currentUserId;
          return <li key={combatant.id} aria-current={isCurrent ? "step" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-md border px-2 py-1 text-xs ${isCurrent ? "border-[var(--accent)] bg-[var(--accent)]/20 font-medium text-[var(--paper)] ring-1 ring-[var(--accent)]" : "border-[var(--paper)]/10 text-[var(--muted)]"}`}>
            <span className="tabular-nums rounded bg-[var(--paper)]/10 px-1.5 py-0.5" title="Initiative">{combatant.initiative}</span>
            <span className={mine ? "text-[var(--lavender)]" : ""}>{combatant.name}{mine ? " (you)" : ""}</span>
            {combatant.is_hidden && <EyeSlash size={12} aria-label="Hidden from players" />}
            {isDM && <span className="flex items-center">
              <button type="button" className="rounded p-0.5 hover:bg-[var(--paper)]/10 disabled:opacity-30" disabled={index === 0} aria-label={`Move ${combatant.name} earlier`} onClick={() => onSend("combat.move", { combatantId: combatant.id, toIndex: index - 1 })}><CaretLeft size={12} aria-hidden="true" /></button>
              <button type="button" className="rounded p-0.5 hover:bg-[var(--paper)]/10 disabled:opacity-30" disabled={index === combat.combatants.length - 1} aria-label={`Move ${combatant.name} later`} onClick={() => onSend("combat.move", { combatantId: combatant.id, toIndex: index + 1 })}><CaretRight size={12} aria-hidden="true" /></button>
              <button type="button" className="rounded p-0.5 hover:bg-[var(--pink)]/20" aria-label={`Remove ${combatant.name} from the fight`} onClick={() => onSend("combat.remove", { combatantId: combatant.id })}><X size={12} aria-hidden="true" /></button>
            </span>}
          </li>;
        })}
      </ol>}
    {picker}
  </section>;
}
