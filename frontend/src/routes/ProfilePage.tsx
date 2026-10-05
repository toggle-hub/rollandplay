import { FormEvent, useState } from "react";
import { patchJSON } from "../api/client";
import type { User } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { ProfileFields, profileErrorMessage } from "../components/ProfileFields";
import { useToast } from "../components/Toast";

/** Change the name and pronouns other players see. Opened from your name in the header. */
export function ProfilePage() {
  const { session, updateUser } = useSession();
  // The workspace only mounts for a signed-in user.
  const user = session.status === "authenticated" ? session.user : null;
  const [username, setUsername] = useState(user?.username ?? "");
  const [pronouns, setPronouns] = useState(user?.pronouns ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  if (!user) return null;
  const unchanged = username.trim() === user.username && pronouns.trim() === user.pronouns;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updated = await patchJSON<User>("/api/me", { username: username.trim(), pronouns: pronouns.trim() });
      updateUser(updated);
      setUsername(updated.username);
      setPronouns(updated.pronouns);
      toast({ kind: "success", message: "Profile saved." });
    } catch (cause) {
      setError(profileErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-page">
      <header><h1 className="page-heading">Profile</h1></header>
      <form className="card max-w-xl space-y-5" onSubmit={submit}>
        <ProfileFields user={user} username={username} pronouns={pronouns} onUsername={setUsername} onPronouns={setPronouns} />
        <p className="text-muted text-sm">Signed in as <span className="break-all text-[var(--paper)]">{user.email}</span>.</p>
        {error && <p role="alert" className="text-sm text-[var(--pink)]">{error}</p>}
        <button className="btn" disabled={busy || !username.trim() || unchanged}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
    </div>
  );
}
