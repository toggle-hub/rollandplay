import { useState, type FormEvent } from "react";
import { ArrowRight, EnvelopeSimple, ShieldCheck } from "@phosphor-icons/react";
import { postJSON } from "../api/client";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setErr("");
    setPending(true);
    try {
      await postJSON<void>("/api/auth/magic-link", { email });
      setSent(true);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "We couldn’t send your link. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-art">
        <div className="relative z-10 max-w-2xl">
          <p className="eyebrow">A good story starts together</p>
          <h1 className="mt-6 text-[clamp(2.75rem,5vw,5rem)] leading-[1.02] tracking-[-0.055em]">Your next chapter<br />starts here.</h1>
          <p className="mt-8 max-w-md text-lg leading-relaxed text-[var(--muted)]">The familiar faces. The unexpected roll. The adventure you’ll still be talking about tomorrow.</p>
          <span className="mt-12 block h-px w-16 bg-[var(--accent)]" aria-hidden="true" />
        </div>
      </section>
      <section className="auth-card">
        {sent ? <div role="status" aria-live="polite">
          <EnvelopeSimple size={36} weight="light" className="mb-8 text-[var(--green)]" aria-hidden="true" />
          <p className="eyebrow">An invitation awaits</p>
          <h2 className="mt-4 text-4xl tracking-tight">Check your email.</h2>
          <p className="text-muted mt-5 leading-relaxed">We sent a sign-in link to <strong className="break-all font-medium text-[var(--paper)]">{email}</strong>. Open it in this browser to pick up where you left off.</p>
          <p className="auth-note mt-6">Not seeing it? Check your spam folder, or make sure your email address is correct.</p>
          <button className="btn-secondary mt-8" onClick={() => { setSent(false); setErr(""); }}>Use another email</button>
        </div> : <>
          <p className="eyebrow">Welcome to Rollandplay</p>
          <h2 className="mt-4 text-4xl tracking-tight">Take your seat.</h2>
          <p className="text-muted mb-8 mt-4 leading-relaxed">New here or returning? Enter your email and we’ll send you a secure sign-in link. No password to remember.</p>
          <form className="auth-form space-y-6" onSubmit={submit} aria-busy={pending}>
            <div>
              <label className="field-label" htmlFor="login-email">Email address</label>
              <input id="login-email" className="mt-2 w-full" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required disabled={pending} aria-describedby={err ? "login-error" : undefined} />
            </div>
            <button className="btn w-full justify-between" disabled={pending}>{pending ? "Sending your link…" : "Send magic link"}<ArrowRight size={20} aria-hidden="true" /></button>
            {err && <p id="login-error" role="alert" className="text-sm text-[var(--pink)]">{err}</p>}
          </form>
          <p className="auth-note mt-8 flex items-start gap-3"><ShieldCheck size={20} className="shrink-0" aria-hidden="true" /><span>Just you and your next adventure. Your link is personal and can only be used once.</span></p>
        </>}
      </section>
    </main>
  );
}
