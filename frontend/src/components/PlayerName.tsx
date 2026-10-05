type PlayerLike = { id?: string; username?: string | null; pronouns?: string | null; email?: string | null };

/** A player's name, followed by their pronouns in brackets when they have set any. */
export function playerLabel(player: PlayerLike | null | undefined, fallback = "Player") {
  if (!player) return fallback;
  const name = player.username || player.email || player.id || fallback;
  const pronouns = player.pronouns?.trim();
  return pronouns ? `${name} (${pronouns})` : name;
}

export function PlayerName({ player, fallback = "Player", className }: { player?: PlayerLike | null; fallback?: string; className?: string }) {
  return <span className={className}>{playerLabel(player, fallback)}</span>;
}
