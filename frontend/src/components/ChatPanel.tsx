import { FormEvent, useLayoutEffect, useRef, useState } from "react";
import { ChatCircle, CheckCircle, DiceFive, LockSimple, PaperPlaneTilt, XCircle } from "@phosphor-icons/react";
import { apiFetch } from "../api/client";
import { PlayerName } from "./PlayerName";
import type { ActionOutcome, ChatMessage, ChatPage, RollResult, RoomMember, TargetOutcome, TargetResult } from "../api/types";
import { isActionRoll } from "../lib/actions";
import { humanizeKey } from "../lib/checks";
import { messageTime, withEarlier, withLatest, type ChatFeed } from "../lib/chat";

type Props = {
  roomId: string;
  /** The room state's newest messages plus live arrivals, oldest first. */
  messages: ChatMessage[];
  /** Whether messages older than `messages` exist. */
  hasEarlier: boolean;
  members: RoomMember[];
  isDM: boolean;
  onSend: (text: string, recipientUserIds: string[], rollExpression?: string) => void;
};

// Within this many pixels of the bottom, the feed follows new messages.
const FOLLOW_DISTANCE_PX = 48;

export function ChatPanel({ roomId, messages, hasEarlier, members, isDM, onSend }: Props) {
  const [text, setText] = useState("");
  const [roll, setRoll] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [error, setError] = useState("");
  // Messages stay once shown, even after they drop out of the room state's newest window.
  const [feed, setFeed] = useState<ChatFeed>(() => withLatest({ messages: [], canLoadEarlier: false }, messages, hasEarlier));
  const [latestSeen, setLatestSeen] = useState(messages);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  // The feed's scroll height after the last change, and the position to restore once earlier messages are in.
  const lastScrollHeight = useRef(0);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  const justSent = useRef(false);
  if (latestSeen !== messages) {
    setLatestSeen(messages);
    setFeed((current) => withLatest(current, messages, hasEarlier));
  }
  const lastMessageId = feed.messages[feed.messages.length - 1]?.id;
  // Game masters may whisper any player; players may whisper the game masters.
  const recipientChoices = members.filter((member) => isDM ? !member.is_dm : member.is_dm);
  const chosenRecipients = recipients.filter((id) => recipientChoices.some((member) => member.user_id === id));

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const restore = restoreScroll.current;
    if (restore) {
      // Earlier messages went in above; keep the same messages in view.
      restoreScroll.current = null;
      el.scrollTop = restore.top + el.scrollHeight - restore.height;
    } else if (justSent.current || lastScrollHeight.current - el.scrollTop - el.clientHeight <= FOLLOW_DISTANCE_PX) {
      // Follow new messages unless the reader scrolled up to older ones.
      el.scrollTop = el.scrollHeight;
    }
    justSent.current = false;
    lastScrollHeight.current = el.scrollHeight;
  }, [lastMessageId, feed.messages.length]);

  async function loadEarlier() {
    const oldest = feed.messages[0];
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    setEarlierError("");
    try {
      const page = await apiFetch<ChatPage>(`/api/rooms/${roomId}/chat?before=${encodeURIComponent(oldest.id)}`);
      const el = feedRef.current;
      if (el && page.messages.length > 0) restoreScroll.current = { height: el.scrollHeight, top: el.scrollTop };
      setFeed((current) => withEarlier(current, page));
    } catch (err) {
      setEarlierError(err instanceof Error ? err.message : "Could not load earlier messages.");
    } finally {
      setLoadingEarlier(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() && !roll.trim()) return;
    setError("");
    try { onSend(text, chosenRecipients, roll.trim() || undefined); justSent.current = true; setText(""); setRoll(""); }
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
      {feed.canLoadEarlier && feed.messages.length > 0 && <div className="flex flex-col items-center gap-1.5">
        <button type="button" className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--lavender)] transition-colors hover:border-[var(--lavender)] disabled:opacity-60" onClick={() => void loadEarlier()} disabled={loadingEarlier}>{loadingEarlier ? "Loading earlier messages…" : "Load earlier messages"}</button>
        {earlierError && <p role="alert" className="mb-0 text-xs text-[var(--pink)]">{earlierError}</p>}
      </div>}
      {feed.messages.length === 0 && <div className="flex h-full flex-col items-center justify-center px-2 text-center">
        <ChatCircle size={32} weight="light" className="mb-3 text-[var(--lavender)]" aria-hidden="true" />
        <p className="mb-1 text-sm text-[var(--paper)]">The table is quiet.</p>
        <p className="mb-0 text-xs leading-relaxed text-[var(--muted)]">Say hello, set the scene,<br />or roll the first die.</p>
      </div>}
      {feed.messages.map((message) => {
        const member = members.find((item) => item.user_id === message.sender_user_id);
        const privateMessage = message.kind === "dm" || !!message.recipient_user_ids?.length;
        const time = messageTime(message.created_at);
        return <article key={message.id} className="min-w-0 text-sm [overflow-wrap:anywhere]">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {message.kind === "system" ? <span className="text-[var(--muted)]">Table update</span> : <PlayerName className="font-medium text-[var(--lavender)]" player={member ? { id: member.user_id, username: member.username, pronouns: member.pronouns } : null} />}
            {privateMessage && <span className="inline-flex items-center gap-1 rounded bg-[var(--lavender)]/10 px-1.5 py-0.5 text-[var(--lavender)]"><LockSimple size={11} aria-hidden="true" />Private{message.recipient_user_ids?.length ? ` · ${message.recipient_user_ids.length}` : ""}</span>}
            {time && <time className="ml-auto tabular-nums text-[var(--muted)]" dateTime={message.created_at} title={time.full}>{time.short}</time>}
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
              <p className="mb-0 mt-2 text-xs text-[var(--muted)]">{message.roll.dice.map((die, index) => <span key={index}>d{die.sides} [{die.values.join(", ")}] </span>)}<span>· modifier {message.roll.modifier}</span></p>
              {message.roll.damage && <div className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--peach)]">
                  <span className="inline-flex items-center gap-1.5 font-medium"><DiceFive size={18} aria-hidden="true" />Damage · {message.roll.damage.expression}</span>
                  <strong className="rounded-md bg-[var(--peach)]/10 px-2 py-1 tabular-nums">total {message.roll.damage.total}</strong>
                </div>
                <p className="mb-0 mt-2 text-xs text-[var(--muted)]">{message.roll.damage.dice.map((die, index) => <span key={index}>d{die.sides} [{die.values.join(", ")}] </span>)}<span>· modifier {message.roll.damage.modifier}</span></p>
              </div>}
            </div>)}
          </div>
        </article>;
      })}
    </div>
    <form className="relative space-y-3 border-t border-[var(--line)] bg-[var(--input)]/30 p-4" onSubmit={submit}>
      {recipientChoices.length > 0 && <details className="text-xs">
        <summary className="cursor-pointer rounded-md py-1 text-[var(--lavender)]">
          <span className="ml-1 inline-flex items-center gap-1.5 align-middle"><LockSimple size={13} aria-hidden="true" />{chosenRecipients.length ? `Private · ${chosenRecipients.length} selected` : "To everyone"}</span>
        </summary>
        <fieldset className="absolute inset-x-4 bottom-full z-20 mb-2 rounded-lg border border-[var(--line)] bg-[var(--ink)] p-3 shadow-xl">
          <legend className="px-1 text-[var(--paper)]">{isDM ? "Private recipients" : "Whisper the game master"}</legend>
          <p className="mb-3 leading-relaxed text-[var(--muted)]">{isDM ? "Leave everyone unchecked to send to the whole table." : "Only you and the game masters you check will see the message and its roll. Leave everyone unchecked to send to the whole table."}</p>
          <div className="max-h-32 space-y-2 overflow-y-auto overscroll-contain">
            {recipientChoices.map((member) => <label className="flex items-start gap-2" key={member.user_id}>
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
  return <p className="mb-0 mt-1 text-xs text-[var(--muted)]">{roll.dice.map((die, index) => <span key={index}>d{die.sides} [{die.values.join(", ")}] </span>)}<span>· modifier {roll.modifier}</span></p>;
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
