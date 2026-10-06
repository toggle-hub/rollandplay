import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, List, SignOut, UserCircle, X } from "@phosphor-icons/react";
import { Brand } from "./components/Brand";
import { NotificationsMenu } from "./components/NotificationsMenu";
import { PlayerName } from "./components/PlayerName";
import { ProfileOnboarding } from "./components/ProfileOnboarding";
import { LoginPage } from "./routes/LoginPage";
import { ConsumePage } from "./routes/ConsumePage";
import { RoomsPage } from "./routes/RoomsPage";
import { FriendsPage } from "./routes/FriendsPage";
import { RoomPage } from "./routes/RoomPage";
import { MapsPage } from "./routes/MapsPage";
import { MapEditorPage } from "./routes/MapEditorPage";
import { RuleBooksPage } from "./routes/RuleBooksPage";
import { SheetsPage } from "./routes/SheetsPage";
import { JoinPage } from "./routes/JoinPage";
import { ProfilePage } from "./routes/ProfilePage";
import { loginDestination, rememberDestination, useSession } from "./auth/SessionContext";

const LandingPage = lazy(() => import("./routes/LandingPage").then((module) => ({ default: module.LandingPage })));

function SessionStatus() {
  const { session, retry } = useSession();
  return (
    <main id="main-content" className="auth-page">
      <div className="card col-span-full mx-auto w-full max-w-xl p-8 md:p-12">
        {session.status === "error" ? <>
          <p className="eyebrow">Connection interrupted</p>
          <h1 className="mt-4 text-3xl">We couldn’t check your session.</h1>
          <p className="text-muted mt-4">Your table can wait. Check your connection and try again.</p>
          <button className="btn mt-8" onClick={retry}>Try again <ArrowRight aria-hidden="true" size={18} /></button>
        </> : <div role="status" aria-live="polite">
          <span className="mb-6 block h-8 w-8 animate-spin rounded-full border-2 border-[var(--muted)]/20 border-t-[var(--accent)] motion-reduce:animate-none" aria-hidden="true" />
          <h1 className="text-3xl">Finding your place at the table.</h1>
          <p className="text-muted mt-4">Checking your session securely…</p>
        </div>}
      </div>
    </main>
  );
}

export function RequireSession({ children }: { children?: ReactNode }) {
  const { session } = useSession();
  const location = useLocation();
  useEffect(() => {
    if (session.status === "anonymous" && session.reason === "unauthorized") {
      rememberDestination(`${location.pathname}${location.search}${location.hash}`);
    }
  }, [session, location.pathname, location.search, location.hash]);
  if (session.status === "checking" || session.status === "error") return <SessionStatus />;
  if (session.status === "anonymous") return <Navigate to={session.reason === "signed-out" ? "/" : "/login"} replace />;
  if (!session.user.profile_complete) return <ProfileOnboarding user={session.user} />;
  return children ?? <Outlet />;
}

function Home() {
  const { session } = useSession();
  if (session.status === "checking" || session.status === "error") return <SessionStatus />;
  return session.status === "authenticated" ? <Navigate to="/rooms" replace /> : <Suspense fallback={<main id="main-content" className="section-container py-32" role="status">Opening your next chapter…</main>}><LandingPage /></Suspense>;
}

function SignInRoute() {
  const { session } = useSession();
  return session.status === "authenticated" ? <Navigate to={loginDestination()} replace /> : <LoginPage />;
}

function Workspace() {
  return <main id="main-content" className="workspace-content"><Outlet /></main>;
}

export function AppShell() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const currentUser = session.status === "authenticated" ? session.user : null;
  const authenticated = currentUser != null;
  const profileReady = !!currentUser?.profile_complete;

  useEffect(() => { setMenuOpen(false); setLogoutError(""); }, [location.pathname, profileReady]);

  async function logout() {
    setSigningOut(true);
    setLogoutError("");
    try {
      await signOut();
      navigate("/", { replace: true });
    } catch {
      setLogoutError("We couldn’t sign you out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className={authenticated ? "workspace-shell min-h-screen" : "min-h-screen"}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--paper)] focus:p-3 focus:text-[var(--ink)]">Skip to content</a>
      <header className="site-header">
        <Link to="/" aria-label="Rollandplay home"><Brand /></Link>
        {profileReady ? <>
          <div className="relative ml-auto flex items-center gap-2 lg:order-last lg:ml-0">
            <NotificationsMenu />
            <div className="lg:hidden">
              <button type="button" className="btn-secondary" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}>
                {menuOpen ? <X size={22} aria-hidden="true" /> : <List size={22} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <div id="workspace-navigation" className={`${menuOpen ? "flex" : "hidden"} w-full flex-col gap-6 lg:flex lg:w-auto lg:flex-1 lg:flex-row lg:items-center lg:justify-between lg:gap-4`}>
            <nav aria-label="Workspace" className="workspace-nav flex flex-wrap gap-1">
              {[["/rooms", "Rooms"], ["/friends", "Friends"], ["/rule-books", "Rule books"], ["/sheets", "Characters"], ["/maps", "Maps"]].map(([to, label]) => (
                <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>{label}</NavLink>
              ))}
            </nav>
            <div className="flex min-w-0 items-center gap-4">
              {currentUser && <Link to="/profile" className="text-muted flex min-w-0 items-center gap-2 text-sm hover:text-[var(--lavender)]" title="Edit your profile">
                <UserCircle size={20} aria-hidden="true" className="shrink-0" />
                <span className="sr-only">Your profile: </span>
                <PlayerName player={currentUser} className="max-w-52 truncate" />
              </Link>}
              <button className="btn-secondary whitespace-nowrap" onClick={logout} disabled={signingOut} aria-busy={signingOut}><SignOut aria-hidden="true" size={18} />{signingOut ? "Signing out…" : "Sign out"}</button>
            </div>
          </div>
        </> : currentUser ? <div className="ml-auto flex min-w-0 items-center gap-4"><PlayerName player={currentUser} className="text-muted hidden max-w-52 truncate text-sm sm:inline" /><button className="btn-secondary whitespace-nowrap" onClick={logout} disabled={signingOut} aria-busy={signingOut}><SignOut aria-hidden="true" size={18} />{signingOut ? "Signing out…" : "Sign out"}</button></div> : <nav aria-label="Main" className="header-links">
          <a href="/#experience" className="nav-link"><span className="sm:hidden">Features</span><span className="hidden sm:inline">How it works</span></a>
          <Link to="/login" className="btn">Sign in <ArrowRight aria-hidden="true" size={17} /></Link>
        </nav>}
      </header>
      {logoutError && <p role="alert" className="mx-auto max-w-7xl px-6 pt-4 text-[var(--pink)]">{logoutError}</p>}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<SignInRoute />} />
        <Route path="/auth/consume" element={<ConsumePage />} />
        <Route element={<RequireSession />}>
          <Route element={<Workspace />}>
            <Route path="/rooms" element={<RoomsPage />} />
            <Route path="/join/:code" element={<JoinPage />} />
            <Route path="/rooms/:roomId" element={<RoomPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/rule-books" element={<RuleBooksPage />} />
            <Route path="/sheets" element={<SheetsPage />} />
            <Route path="/maps" element={<MapsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/maps/:mapId/edit" element={<MapEditorPage />} />
          </Route>
        </Route>
        <Route path="*" element={<main id="main-content" className="auth-page"><div className="card mx-auto max-w-xl p-8"><h1 className="text-3xl">That path is uncharted.</h1><p className="text-muted my-6">This page doesn’t exist. Let’s get you back.</p><Link className="btn" to="/">Back home <ArrowRight aria-hidden="true" size={18} /></Link></div></main>} />
      </Routes>
    </div>
  );
}
