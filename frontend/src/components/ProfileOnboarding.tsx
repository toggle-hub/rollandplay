import { FormEvent, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { patchJSON } from "../api/client";
import type { User } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { PlayerName } from "./PlayerName";

export function ProfileOnboarding({ user }: { user: User }) {
  const { updateUser } = useSession();
  const [username, setUsername] = useState(user.username || user.email.split("@")[0] || "Player");
  const [pronouns, setPronouns] = useState(user.pronouns || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updated = await patchJSON<User>("/api/me", { username: username.trim(), pronouns: pronouns.trim() });
      updateUser(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return <main id="main-content" className="auth-page">
    <div className="auth-art"><p className="eyebrow">Your seat at the table</p><h1>What should we call you?</h1><p>Your name and pronouns show together anywhere other players see you.</p></div>
    <form className="auth-card auth-form" onSubmit={submit}>
      <h1>Set your player profile.</h1>
      <p className="auth-note">You can use your real name, a handle, or whatever your party knows you by.</p>
      <label className="field-label" htmlFor="profile-name">What should we call you?</label>
      <input id="profile-name" required maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="name" />
      <label className="field-label" htmlFor="profile-pronouns">Pronouns</label>
      <input id="profile-pronouns" required maxLength={40} value={pronouns} onChange={(event) => setPronouns(event.target.value)} placeholder="she/her, he/him, they/them" />
      <div className="rounded-lg border border-[var(--paper)]/10 bg-[var(--input)]/20 p-4 text-sm"><span className="text-muted block text-xs">Preview</span><PlayerName player={{ ...user, username, pronouns }} /></div>
      {error && <p role="alert" className="text-sm text-[var(--pink)]">{error}</p>}
      <button className="btn" disabled={busy || !username.trim() || !pronouns.trim()}>{busy ? "Saving…" : "Save and continue"} <ArrowRight size={18} aria-hidden="true" /></button>
    </form>
  </main>;
}
