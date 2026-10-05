/** Green when the member has the room open right now, a hollow ring otherwise. */
export function PresenceDot({ online }: { online: boolean }) {
  const label = online ? "Online" : "Offline";
  return <span role="img" aria-label={label} title={label}
    className={`mr-2 inline-block size-2 shrink-0 rounded-full align-middle ${online ? "bg-[var(--green)]" : "border border-[var(--muted)]"}`} />;
}
