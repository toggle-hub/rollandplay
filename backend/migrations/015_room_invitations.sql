-- Pending invitations a game master sent to a user by username. Accepting one joins the room
-- without the invite code or password; accepting, declining or revoking deletes the row.
create table if not exists room_invitations(
  id uuid primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  inviter_user_id uuid not null references users(id) on delete cascade,
  invitee_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(room_id, invitee_user_id),
  check(inviter_user_id <> invitee_user_id)
);
create index if not exists room_invitations_invitee_idx on room_invitations(invitee_user_id, created_at desc);
create index if not exists room_invitations_inviter_idx on room_invitations(inviter_user_id);
