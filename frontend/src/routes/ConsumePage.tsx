import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Key } from "@phosphor-icons/react";
import { postJSON } from "../api/client";
import type { User } from "../api/types";
import { clearDestination, loginDestination, useSession } from "../auth/SessionContext";

export function ConsumePage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const { signIn } = useSession();
  const [error, setError] = useState("");
  const consumption = useRef<{ token: string; promise: Promise<{ user: User }> } | null>(null);

  useEffect(() => {
    if (!token) {
      setError("This sign-in link is missing its token. Request a new link to continue.");
      return;
    }
    let active = true;
    setError("");
    if (consumption.current?.token !== token) {
      consumption.current = { token, promise: postJSON<{ user: User }>("/api/auth/consume", { token }) };
    }
    consumption.current.promise.then(({ user }) => {
      if (!active) return;
      signIn(user);
      const destination = loginDestination();
      clearDestination();
      navigate(destination, { replace: true });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "We couldn’t open this sign-in link. Please request another.");
    });
    return () => { active = false; };
  }, [token, navigate, signIn]);

  return <main id="main-content" className="auth-page">
    <div className="auth-card col-span-full mx-auto w-full max-w-xl">
      <Key aria-hidden="true" size={36} weight="light" className="mb-8 text-[var(--accent)]" />
      {error ? <>
        <h1 className="text-3xl tracking-tight">Let’s get you a new invitation.</h1>
        <p role="alert" className="text-[var(--pink)] mt-5">{error}</p>
        <Link to="/login" className="btn mt-8">Request a new link <ArrowRight size={18} aria-hidden="true" /></Link>
      </> : <div role="status" aria-live="polite">
        <h1 className="text-3xl tracking-tight">Opening your next chapter.</h1>
        <p className="text-muted mt-5">Signing you in securely…</p>
      </div>}
    </div>
  </main>;
}
