import { ApiError } from "../api/client";
import type { User } from "../api/types";
import { PlayerName } from "./PlayerName";

/** What went wrong saving a profile, in plain words. */
export function profileErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 409) return "Another player already uses that name. Try a different one.";
  return cause instanceof Error ? cause.message : "Could not save your profile.";
}

/** Name and optional pronouns, with a preview of how other players see them. Used at first sign-in and on the Profile page. */
export function ProfileFields({ user, username, pronouns, onUsername, onPronouns }: {
  user: User;
  username: string;
  pronouns: string;
  onUsername: (value: string) => void;
  onPronouns: (value: string) => void;
}) {
  return <>
    <div className="space-y-2">
      <label className="field-label block" htmlFor="profile-name">Name</label>
      <input id="profile-name" className="w-full" required maxLength={80} value={username} onChange={(event) => onUsername(event.target.value)} autoComplete="nickname" aria-describedby="profile-name-help" />
      <p id="profile-name-help" className="text-muted text-xs">Your real name, a handle, or whatever your party knows you by. Game masters and friends find you by it.</p>
    </div>
    <div className="space-y-2">
      <label className="field-label block" htmlFor="profile-pronouns">Pronouns (optional)</label>
      <input id="profile-pronouns" className="w-full" maxLength={40} value={pronouns} onChange={(event) => onPronouns(event.target.value)} placeholder="she/her, he/him, they/them" />
    </div>
    <div className="rounded-lg border border-[var(--paper)]/10 bg-[var(--input)]/20 p-4 text-sm"><span className="text-muted block text-xs">Other players see</span><PlayerName player={{ ...user, username: username.trim(), pronouns }} /></div>
  </>;
}
