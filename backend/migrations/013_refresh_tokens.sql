-- A sign-in (sessions row) now has two cookies: a short-lived access token sent with every request
-- (session_access_tokens), and a refresh token that renews it and rotates on every use
-- (sessions.refresh_hash; the one it replaced stays in previous_refresh_hash so a concurrent
-- refresh from another tab is recognised and a replayed old token revokes the sign-in).
-- sessions.expires_at is when the refresh token expires; each refresh pushes it forward.
-- Old single-token sessions can't be converted, so everyone signs in again once.
delete from sessions;
alter table sessions rename column token_hash to refresh_hash;
alter table sessions add column previous_refresh_hash text, add column refreshed_at timestamptz;
create index sessions_previous_refresh_hash_idx on sessions(previous_refresh_hash);
create table session_access_tokens(
  token_hash text primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  expires_at timestamptz not null
);
create index session_access_tokens_session_idx on session_access_tokens(session_id);
