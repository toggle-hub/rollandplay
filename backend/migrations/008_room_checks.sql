-- A game master prompts room members to roll a check (optionally a named encounter such as
-- "Goblin ambush"). Each target rolls once; results also land in chat as roll messages.
create table if not exists room_checks (
  id uuid primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  title text not null default '',
  check_kind text not null check (check_kind in ('ability', 'save', 'skill', 'attribute')),
  check_key text not null,
  dc integer not null check (dc between 1 and 100),
  -- Private: each target sees only their own prompt and result; game masters see everything.
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists room_checks_room_created_idx on room_checks(room_id, created_at);

create table if not exists room_check_targets (
  check_id uuid not null references room_checks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  roll jsonb,
  success boolean,
  rolled_by uuid references users(id) on delete set null,
  rolled_at timestamptz,
  primary key (check_id, user_id)
);
create index if not exists room_check_targets_user_idx on room_check_targets(user_id);
