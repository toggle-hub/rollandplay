import type { Ref } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChatCircle, Circle, LinkSimple, MapTrifold } from "@phosphor-icons/react";
import type { Room } from "../api/types";
import { RoomControlsHelp } from "./RoomControlsHelp";
import { useToast } from "./Toast";

/** The room's live connection: first connecting, live, or trying again after it dropped. */
export type RoomConnection = "connecting" | "live" | "reconnecting";

const connectionLabels: Record<RoomConnection, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

type Props = {
  room: Room;
  connection: RoomConnection;
  isDM: boolean;
  toolsLabel: string;
  toolsOpen: boolean;
  /** Opens the tools panel on phones, where it doesn't fit beside the map; focus returns here when it closes. */
  onOpenTools: () => void;
  toolsButtonRef: Ref<HTMLButtonElement>;
  /** Shows chat on screens where it sits below the map. */
  onOpenChat: () => void;
};

/** One compact row above the table: room name, rule book, invite link, connection and controls help. */
export function RoomHeader({ room, connection, isDM, toolsLabel, toolsOpen, onOpenTools, toolsButtonRef, onOpenChat }: Props) {
  const toast = useToast();

  async function copyInviteLink() {
    const link = `${window.location.origin}/join/${room.invite_code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast({ kind: "success", message: "Invite link copied. Send it to your players." });
    } catch {
      toast({ kind: "error", message: `Couldn't copy the link. Share this instead: ${link}` });
    }
  }

  return <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
    <Link className="btn-secondary size-9 min-h-0 shrink-0 p-0" to="/rooms" aria-label="All rooms" title="All rooms"><ArrowLeft size={18} aria-hidden="true" /></Link>
    <div className="min-w-0 flex-1">
      <h1 className="mb-0 truncate text-xl font-normal leading-tight tracking-[-0.02em] sm:text-2xl">{room.name}</h1>
      <p className="text-muted mb-0 truncate text-xs">Rule book <span className="ml-1 text-[var(--lavender)]">{room.rule_book.name}</span></p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-muted mb-0 hidden text-xs sm:block">Invite code <span className="ml-1 select-all font-mono text-sm text-[var(--paper)]">{room.invite_code}</span></p>
      <button className="btn-secondary min-h-9 gap-2 px-3 py-1.5 text-xs" type="button" onClick={() => void copyInviteLink()}>
        <LinkSimple size={16} aria-hidden="true" />Copy invite link
      </button>
      <p role="status" className="mb-0 flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted)]">
        <Circle size={8} weight="fill" className={connection === "live" ? "text-[var(--green)]" : connection === "reconnecting" ? "animate-pulse text-[var(--peach)]" : "text-[var(--muted)]"} aria-hidden="true" />
        {connectionLabels[connection]}
      </p>
      <RoomControlsHelp isDM={isDM} />
    </div>
    <div className="flex w-full justify-end gap-2 lg:hidden">
      <button ref={toolsButtonRef} className="btn-secondary min-h-9 flex-1 gap-2 px-3 py-1.5 text-xs md:hidden!" type="button" aria-expanded={toolsOpen} aria-controls="room-tools-panel" onClick={onOpenTools}>
        <MapTrifold size={16} aria-hidden="true" />{toolsLabel}
      </button>
      <button className="btn-secondary min-h-9 flex-1 gap-2 px-3 py-1.5 text-xs md:flex-none" type="button" onClick={onOpenChat}>
        <ChatCircle size={16} aria-hidden="true" />Chat
      </button>
    </div>
  </header>;
}
