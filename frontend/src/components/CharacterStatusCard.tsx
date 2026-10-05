import { useState } from "react";
import { Bed, Heartbeat } from "@phosphor-icons/react";
import type { RoomToken } from "../api/types";
import { conditionLabel, statusLabels } from "../lib/conditions";

type Props = {
  tokens: RoomToken[];
  selectedTokenIds: readonly string[];
  isDM: boolean;
  /** Sends a room websocket message; false when the room is not connected. */
  onSend: (type: string, body: unknown) => boolean;
};

/**
 * Players see their own characters on the map: HP, temporary HP, armor class, death saves,
 * conditions and limited uses left. The game master sees the selected token the same way and
 * can give the whole party a long rest.
 */
export function CharacterStatusCard({ tokens, selectedTokenIds, isDM, onSend }: Props) {
  const [confirmRest, setConfirmRest] = useState(false);
  const shown = isDM
    ? selectedTokenIds.length === 1 ? tokens.filter((token) => token.id === selectedTokenIds[0]) : []
    : tokens.filter((token) => token.side === "own");
  if (!isDM && shown.length === 0) return null;
  return <section className="card space-y-4 p-5!" aria-label={isDM ? "Token status" : "Your character"}>
    <h2 className="flex items-center gap-2 text-xl"><Heartbeat size={22} className="text-[var(--accent)]" aria-hidden="true" />{isDM ? "Token status" : "Your character"}</h2>
    {shown.length === 0 && <p className="text-muted text-sm">Select a token to see its health, conditions and uses left.</p>}
    {shown.map((token) => <TokenStatus key={token.id} token={token} />)}
    {isDM && <div className="space-y-2 border-t border-[var(--line)] pt-4">
      <button className="btn-secondary w-full" type="button" onBlur={() => setConfirmRest(false)} onClick={() => {
        if (!confirmRest) {
          setConfirmRest(true);
          return;
        }
        if (onSend("token.rest", { party: true })) setConfirmRest(false);
      }}><Bed size={18} aria-hidden="true" />{confirmRest ? "Confirm party long rest" : "Long rest for the party"}</button>
      <p className="text-muted text-xs">Every player character on the map regains all HP and limited uses; temporary HP and death saves are cleared.</p>
    </div>}
  </section>;
}

function TokenStatus({ token }: { token: RoomToken }) {
  const hp = token.hit_points;
  const max = token.max_hit_points;
  const ratio = hp !== undefined && max ? Math.min(1, Math.max(0, hp / max)) : undefined;
  const saves = token.death_saves;
  const showSaves = !!saves && (!!token.status || saves.successes > 0 || saves.failures > 0);
  const limited = (token.actions ?? []).filter((action) => action.uses);
  const items = token.items ?? [];
  const conditions = token.conditions ?? [];
  return <div className="space-y-3">
    <p className="flex flex-wrap items-center gap-2 font-medium text-[var(--paper)]">
      <span className="min-w-0 break-words">{token.name}</span>
      {token.status && <span className="rounded-full border border-[var(--peach)]/50 px-2 py-0.5 text-xs text-[var(--peach)]">{statusLabels[token.status]}</span>}
    </p>
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div className="col-span-2">
        <dt className="text-muted text-xs">Hit points</dt>
        <dd className="tabular-nums">
          {hp === undefined ? "Not set" : <><span className="text-lg font-medium">{hp}</span>{max !== undefined && <span className="text-muted"> / {max}</span>}</>}
          {!!token.temporary_hit_points && <span className="ml-2 text-[var(--lavender)]">+{token.temporary_hit_points} temporary</span>}
        </dd>
        {ratio !== undefined && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--line)]" aria-hidden="true">
          <div className={`h-full ${ratio > 0.5 ? "bg-[var(--green)]" : ratio > 0.25 ? "bg-[var(--peach)]" : "bg-[var(--pink)]"}`} style={{ width: `${ratio * 100}%` }} />
        </div>}
      </div>
      <div>
        <dt className="text-muted text-xs">Armor class</dt>
        <dd className="text-lg font-medium tabular-nums">{token.defenses?.armor_class ?? "—"}</dd>
      </div>
      {showSaves && saves && <div>
        <dt className="text-muted text-xs">Death saves</dt>
        <dd className="space-y-0.5 text-xs">
          <span className="block"><span className="sr-only">{saves.successes} of 3 successes</span><span aria-hidden="true" className="tracking-widest text-[var(--green)]">{pips(saves.successes, "●")}</span></span>
          <span className="block"><span className="sr-only">{saves.failures} of 3 failures</span><span aria-hidden="true" className="tracking-widest text-[var(--pink)]">{pips(saves.failures, "✕")}</span></span>
          {saves.stable && <span className="text-muted block">Stable</span>}
        </dd>
      </div>}
    </dl>
    {conditions.length > 0 && <div>
      <p className="text-muted text-xs">Conditions</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {conditions.map((condition) => <li key={condition} className="rounded-full border border-[var(--lavender)]/40 bg-[var(--lavender)]/10 px-2.5 py-0.5 text-xs text-[var(--lavender)]">{conditionLabel(condition)}</li>)}
      </ul>
    </div>}
    {(limited.length > 0 || items.length > 0) && <div>
      <p className="text-muted text-xs">Uses left</p>
      <ul className="mt-1 space-y-1 text-sm">
        {limited.map((action) => <li key={action.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{action.name}</span><span className="shrink-0 tabular-nums">{action.uses?.remaining} / {action.uses?.max}</span></li>)}
        {items.map((item) => <li key={item.id} className="flex justify-between gap-3"><span className="min-w-0 truncate">{item.name}</span><span className="shrink-0 tabular-nums">× {item.quantity}</span></li>)}
      </ul>
    </div>}
  </div>;
}

/** Three marks, the first `count` filled: "●●○". */
function pips(count: number, mark: string) {
  return Array.from({ length: 3 }, (_, index) => index < count ? mark : "○").join("");
}
