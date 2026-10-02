type PlayerLike = { id?: string; username?: string | null; pronouns?: string | null; email?: string | null };

export function playerLabel(player: PlayerLike | null | undefined, fallback = "Player") {
  if (!player) return `${fallback} (pronouns not set)`;
  const name = player.username || player.email || player.id || fallback;
  const pronouns = player.pronouns?.trim() || "pronouns not set";
  return `${name} (${pronouns})`;
}

export function PlayerName({ player, fallback = "Player", className }: { player?: PlayerLike | null; fallback?: string; className?: string }) {
  return <span className={className}>{playerLabel(player, fallback)}</span>;
}
