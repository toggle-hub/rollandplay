import { FormEvent, useLayoutEffect, useRef, useState } from "react";
import { ChatCircle, CheckCircle, DiceFive, LockSimple, PaperPlaneTilt, XCircle } from "@phosphor-icons/react";
import { PlayerName } from "./PlayerName";
import { DiceValues } from "./DiceValues";
import type { ActionOutcome, ChatMessage, RollResult, RoomMember, TargetOutcome, TargetResult } from "../api/types";
import { isActionRoll } from "../lib/actions";
import { humanizeKey } from "../lib/checks";

type Props = {
  messages: ChatMessage[];
  members: RoomMember[];
  isDM: boolean;
  onSend: (text: string, recipientUserIds: string[], rollExpression?: string) => void;
};
export function ChatPanel({ messages, members, isDM, onSend }: Props) {
  const [text, setText] = useState("");
  const [roll, setRoll] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [error, setError] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const lastMessageId = messages[messages.length - 1]?.id;

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [lastMessageId, messages.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !roll.trim()) return;
    setError("");
    try { onSend(text, isDM ? recipients : [], roll.trim() || undefined); setText(""); setRoll(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not send your message."); }
  }
  return <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]" aria-labelledby="chat-heading">
    <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--purple)]/15 text-[var(--purple)]"><ChatCircle size={20} weight="duotone" aria-hidden="true" /></span>
      <div>
        <h2 id="chat-heading" className="mb-0 text-base font-medium">Table talk</h2>
        <p className="mb-0 mt-0.5 text-xs text-[var(--muted)]">The story between the rolls.</p>
      </div>
    </header>
    <div ref={feedRef} role="log" aria-label="Room messages" aria-live="polite" aria-relevant="additions" tabIndex={0} className="h-80 max-h-[50dvh] min-h-48 space-y-4 overflow-y-auto overscroll-contain p-4">
      {messages.length === 0 && <div className="flex h-full flex-col items-center justify-center px-2 text-center">
        <ChatCircle size={32} weight="light" className="mb-3 text-[var(--lavender)]" aria-hidden="true" />
        <p className="mb-1 text-sm text-[var(--paper)]">The table is quiet.</p>
        <p className="mb-0 text-xs leading-relaxed text-[var(--muted)]">Say hello, set the scene,<br />or roll the first die.</p>
      </div>}
      {messages.map((message) => {
        const member = members.find((item) => item.user_id === message.sender_user_id);
        const privateMessage = message.kind === "dm" || !!message.recipient_user_ids?.length;
        return <article key={message.id} className="min-w-0 text-sm [overflow-wrap:anywhere]">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {message.kind === "system" ? <span className="text-[var(--muted)]">Table update</span> : <PlayerName className="font-medium text-[var(--lavender)]" player={member ? { id: member.user_id, username: member.username, pronouns: member.pronouns } : null} />}
            {privateMessage && <span className="inline-flex items-center gap-1 rounded bg-[var(--lavender)]/10 px-1.5 py-0.5 text-[var(--lavender)]"><LockSimple size={11} aria-hidden="true" />Private{message.recipient_user_ids?.length ? ` · ${message.recipient_user_ids.length}` : ""}</span>}
          </div>
          <div className={message.kind === "system" ? "border-l-2 border-[var(--line)] pl-3 text-xs leading-relaxed text-[var(--muted)]" : `rounded-xl rounded-tl-sm border p-3 leading-relaxed ${privateMessage ? "border-[var(--lavender)]/20 bg-[var(--lavender)]/5" : "border-[var(--paper)]/5 bg-[var(--input)]/60"}`}>
            {message.body && <p className="mb-0 whitespace-pre-wrap">{message.body}</p>}
            {message.kind === "roll" && message.roll && (isActionRoll(message.roll) ? <ActionRollView action={message.roll.action} spaced={!!message.body} /> : <div className={message.body ? "mt-3" : ""}>
              {message.roll.check && <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--muted)]">{message.roll.check.title ? `${message.roll.check.title} · ` : ""}{message.roll.check.label} · DC {message.roll.check.dc}</span>
                {message.roll.check.success
                  ? <strong className="inline-flex items-center gap-1 rounded-md bg-[var(--green)]/10 px-2 py-1 text-xs text-[var(--green)]"><CheckCircle size={14} weight="fill" aria-hidden="true" />Success</strong>
                  : <strong className="inline-flex items-center gap-1 rounded-md bg-[var(--pink)]/10 px-2 py-1 text-xs text-[var(--pink)]"><XCircle size={14} weight="fill" aria-hidden="true" />Failure</strong>}
              </div>}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--peach)]">
                <span className="inline-flex items-center gap-1.5 font-medium"><DiceFive size={18} aria-hidden="true" />{message.roll.damage ? `Attack · ${message.roll.expression}` : message.roll.expression}</span>
                <strong className="rounded-md bg-[var(--peach)]/10 px-2 py-1 tabular-nums">total {message.roll.total}</strong>
              </div>
              <DiceValues roll={message.roll} className="mb-0 mt-2 text-xs text-[var(--muted)]" />
              {message.roll.damage && <div className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--peach)]">
                  <span className="inline-flex items-center gap-1.5 font-medium"><DiceFive size={18} aria-hidden="true" />Damage · {message.roll.damage.expression}</span>
                  <strong className="rounded-md bg-[var(--peach)]/10 px-2 py-1 tabular-nums">total {message.roll.damage.total}</strong>
                </div>
                <DiceValues roll={message.roll.damage} className="mb-0 mt-2 text-xs text-[var(--muted)]" />
              </div>}
            </div>)}
          </div>
        </article>;
      })}
    </div>
    <form className="relative space-y-3 border-t border-[var(--line)] bg-[var(--input)]/30 p-4" onSubmit={submit}>
      {isDM && <details className="text-xs">
        <summary className="cursor-pointer rounded-md py-1 text-[var(--lavender)]">
          <span className="ml-1 inline-flex items-center gap-1.5 align-middle"><LockSimple size={13} aria-hidden="true" />{recipients.length ? `Private · ${recipients.length} selected` : "To everyone"}</span>
        </summary>
        <fieldset className="absolute inset-x-4 bottom-full z-20 mb-2 rounded-lg border border-[var(--line)] bg-[var(--ink)] p-3 shadow-xl">
          <legend className="px-1 text-[var(--paper)]">Private recipients</legend>
          <p className="mb-3 leading-relaxed text-[var(--muted)]">Leave everyone unchecked to send to the whole table.</p>
          <div className="max-h-32 space-y-2 overflow-y-auto overscroll-contain">
            {members.filter((member) => !member.is_dm).map((member) => <label className="flex items-start gap-2" key={member.user_id}>
              <input className="mt-1 shrink-0" type="checkbox" checked={recipients.includes(member.user_id)} onChange={(e) => setRecipients((current) => e.target.checked ? [...current, member.user_id] : current.filter((id) => id !== member.user_id))} />
              <PlayerName className="min-w-0 break-words text-xs leading-relaxed" player={{ id: member.user_id, username: member.username, pronouns: member.pronouns }} />
            </label>)}
          </div>
        </fieldset>
      </details>}
      <label className="sr-only" htmlFor="chat-message">Message</label>
      <input id="chat-message" type="text" className="block w-full text-sm!" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }} placeholder="What does your character do?" aria-describedby="chat-keyboard-hint" />
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]" htmlFor="chat-roll"><DiceFive size={14} aria-hidden="true" />Dice roll <span>(optional)</span></label>
          <input id="chat-roll" className="w-full text-sm!" value={roll} onChange={(e) => setRoll(e.target.value)} placeholder="1d20+5" />
        </div>
        <button className="grid size-11 shrink-0 place-items-center rounded-lg bg-[var(--purple)] text-[var(--ink)] transition-colors hover:bg-[var(--lavender)] disabled:opacity-40" type="submit" disabled={!text.trim() && !roll.trim()} aria-label="Send message" title="Send message">
          <PaperPlaneTilt size={20} weight="fill" aria-hidden="true" />
        </button>
      </div>
      <p id="chat-keyboard-hint" className="mb-0 text-[10px] leading-relaxed text-[var(--muted)]">Enter to send</p>
      {error && <p role="alert" className="mb-0 text-xs text-[var(--pink)]">{error}</p>}
    </form>
  </section>;
}

/** Badge label per result, and whether it reads as a success (green) or a setback (pink). */
const resultBadges: Record<TargetResult, { label: string; good: boolean }> = {
  hit: { label: "Hit", good: true },
  critical: { label: "Critical hit", good: true },
  miss: { label: "Miss", good: false },
  saved: { label: "Saved", good: true },
  failed: { label: "Failed", good: false },
  healed: { label: "Healed", good: true },
  no_effect: { label: "No effect", good: false },
  success: { label: "Success", good: true },
  failure: { label: "Failure", good: false },
  stable: { label: "Stable", good: true },
  dead: { label: "Dead", good: false },
  revived: { label: "Back up", good: true },
};

function DiceDetail({ roll }: { roll: RollResult }) {
  return <DiceValues roll={roll} />;
}

function ResultBadge({ result }: { result: TargetResult }) {
  const { label, good } = resultBadges[result];
  return good
    ? <strong className="inline-flex items-center gap-1 rounded-md bg-[var(--green)]/10 px-2 py-1 text-xs text-[var(--green)]"><CheckCircle size={14} weight="fill" aria-hidden="true" />{label}</strong>
    : <strong className="inline-flex items-center gap-1 rounded-md bg-[var(--pink)]/10 px-2 py-1 text-xs text-[var(--pink)]"><XCircle size={14} weight="fill" aria-hidden="true" />{label}</strong>;
}

function TargetRow({ target }: { target: TargetOutcome }) {
  const tag = target.dead ? "Dead" : target.down ? "Down" : "";
  return <li className="rounded-lg border border-[var(--paper)]/5 bg-[var(--surface)]/40 p-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium">{target.name}</span>
      <span className="inline-flex flex-wrap items-center gap-2">
        {!!target.damage && <span className="font-semibold tabular-nums text-[var(--pink)]">-{target.damage}</span>}
        {!!target.healing && <span className="font-semibold tabular-nums text-[var(--green)]">+{target.healing}</span>}
        {target.defense && <span className="text-xs text-[var(--muted)]">{target.defense}</span>}
        {tag && !(tag === "Dead" && target.result === "dead") && <span className="rounded bg-[var(--pink)]/10 px-1.5 py-0.5 text-xs text-[var(--pink)]">{tag}</span>}
        <ResultBadge result={target.result} />
      </span>
    </div>
    {target.roll && <>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--peach)]">
        <span className="inline-flex items-center gap-1"><DiceFive size={14} aria-hidden="true" />{target.roll.expression}</span>
        <span className="tabular-nums">total {target.roll.total}</span>
      </div>
      <DiceDetail roll={target.roll} />
    </>}
  </li>;
}

function ActionRollView({ action, spaced }: { action: ActionOutcome; spaced: boolean }) {
  const header = [action.name];
  if (action.kind === "save" && action.save_ability) header.push(`${humanizeKey(action.save_ability)} save DC ${action.dc ?? 0}`);
  if (action.damage_type) header.push(action.damage_type);
  return <div className={spaced ? "mt-3" : ""}>
    <p className="mb-2 text-xs text-[var(--muted)]">{header.join(" · ")}</p>
    {action.effect && <div className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--peach)]">
        <span className="inline-flex items-center gap-1.5 font-medium"><DiceFive size={18} aria-hidden="true" />{action.kind === "heal" ? "Healing" : "Damage"} · {action.effect.expression}</span>
        <strong className="rounded-md bg-[var(--peach)]/10 px-2 py-1 tabular-nums">total {action.effect.total}</strong>
      </div>
      <DiceDetail roll={action.effect} />
    </div>}
    {action.targets.length === 0
      ? <p className="mb-0 text-xs text-[var(--muted)]">No creatures in the area</p>
      : <ul className="m-0 list-none space-y-2 p-0">{action.targets.map((target) => <TargetRow key={target.token_id} target={target} />)}</ul>}
    {action.uses_left !== undefined && <p className="mb-0 mt-2 text-xs text-[var(--muted)]">{action.uses_left} {action.uses_left === 1 ? "use" : "uses"} left</p>}
    {action.quantity_left !== undefined && <p className="mb-0 mt-2 text-xs text-[var(--muted)]">{action.quantity_left} left</p>}
  </div>;
}
