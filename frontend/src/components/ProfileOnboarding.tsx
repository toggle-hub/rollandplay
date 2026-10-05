import { FormEvent, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { patchJSON } from "../api/client";
import type { User } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { ProfileFields, profileErrorMessage } from "./ProfileFields";

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
      setError(profileErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main id="main-content" className="auth-page">
    <div className="auth-art"><p className="eyebrow">Your seat at the table</p><h2>Welcome, adventurer.</h2><p>Your name, and your pronouns if you add them, show anywhere other players see you. You can change them later from your profile.</p></div>
    <form className="auth-card auth-form" onSubmit={submit}>
      <h1>What should we call you?</h1>
      <ProfileFields user={user} username={username} pronouns={pronouns} onUsername={setUsername} onPronouns={setPronouns} />
      {error && <p role="alert" className="text-sm text-[var(--pink)]">{error}</p>}
      <button className="btn" disabled={busy || !username.trim()}>{busy ? "Saving…" : "Save and continue"} <ArrowRight size={18} aria-hidden="true" /></button>
    </form>
  </main>;
}
