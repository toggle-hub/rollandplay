import { CheckCircle, DiceFive, LockSimple, XCircle } from "@phosphor-icons/react";
import type { RoomCheck, RoomCheckTarget, RoomMember } from "../api/types";
import { playerLabel } from "./PlayerName";

type Props = {
  checks: RoomCheck[];
  members: RoomMember[];
  currentUserId?: string;
  isDM: boolean;
  /** Rolls for the current user, or for `userId` when a game master rolls on a player's behalf. */
  onRoll: (checkId: string, userId?: string) => void;
  onClose: (checkId: string) => void;
};

/** Checks the game master prompted: open ones can be rolled, closed ones keep each player's outcome. */
export function RoomChecks({ checks, members, currentUserId, isDM, onRoll, onClose }: Props) {
  if (checks.length === 0) return null;
  return <section className="card space-y-4" aria-labelledby="room-checks-heading">
    <h2 id="room-checks-heading" className="flex items-center gap-2 text-xl"><DiceFive size={22} className="text-[var(--accent)]" aria-hidden="true" />Checks</h2>
    <ul className="space-y-3">
      {checks.map((check) => {
        const open = !check.closed_at;
        const heading = check.title || check.label;
        return <li key={check.id} className="space-y-2 border-t border-[var(--paper)]/10 pt-3" aria-label={heading}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="mb-0 break-words text-base font-medium">{heading}</h3>
              <p className="mb-0 text-xs text-[var(--muted)]">{check.title ? `${check.label} · ` : ""}DC {check.dc}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
              <span className={open ? "text-[var(--green)]" : "text-[var(--muted)]"}>{open ? "Open" : "Closed"}</span>
              {check.is_private && <span className="inline-flex items-center gap-1 text-[var(--lavender)]"><LockSimple size={11} aria-hidden="true" />Private</span>}
            </div>
          </div>
          <ul className="space-y-1.5">
            {check.targets.map((target) => {
              const member = members.find((item) => item.user_id === target.user_id);
              const name = playerLabel(member ? { id: member.user_id, username: member.username, pronouns: member.pronouns } : null);
              const isMe = target.user_id === currentUserId;
              const canRoll = open && !target.roll && (isMe || isDM);
              return <li key={target.user_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 break-words">{name}{isMe ? " (you)" : ""}</span>
                {target.roll
                  ? <TargetOutcome target={target} />
                  : canRoll
                    ? <button className={isMe ? "btn min-h-8 shrink-0 px-3 py-1 text-xs" : "btn-secondary min-h-8 shrink-0 px-3 py-1 text-xs"} type="button" aria-label={isMe ? `Roll ${check.label}` : `Roll ${check.label} for ${name}`} onClick={() => onRoll(check.id, isMe ? undefined : target.user_id)}>{isMe ? "Roll" : "Roll for them"}</button>
                    : <span className="shrink-0 text-xs text-[var(--muted)]">{open ? "Waiting" : "Did not roll"}</span>}
              </li>;
            })}
          </ul>
          {isDM && open && <button className="btn-secondary min-h-8 w-full px-3 py-1 text-xs" type="button" onClick={() => onClose(check.id)}>Close check</button>}
        </li>;
      })}
    </ul>
  </section>;
}

function TargetOutcome({ target }: { target: RoomCheckTarget }) {
  const total = target.roll?.total;
  return target.success
    ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--green)]"><CheckCircle size={14} weight="fill" aria-hidden="true" />Success · {total}</span>
    : <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--pink)]"><XCircle size={14} weight="fill" aria-hidden="true" />Failure · {total}</span>;
}
