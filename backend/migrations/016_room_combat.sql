-- A room's running fight: at most one per room, tied to the room map it started on. The turn
-- belongs to the first combatant whose position is at or after current_position, so a combatant
-- whose token is deleted mid-turn passes the turn to the next one in order.
create table if not exists room_combats(
  room_id uuid primary key references rooms(id) on delete cascade,
  room_map_id uuid not null references room_maps(id) on delete cascade,
  round int not null default 1 check(round >= 1),
  current_position int not null default 0,
  started_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists room_combats_room_map_id_idx on room_combats(room_map_id);
create index if not exists room_combats_started_by_idx on room_combats(started_by);
-- Tokens in the turn order. initiative is the rolled total; roll keeps the dice for the record.
create table if not exists room_combatants(
  id uuid primary key,
  room_id uuid not null references room_combats(room_id) on delete cascade,
  token_id uuid not null references room_tokens(id) on delete cascade,
  position int not null,
  initiative int not null,
  roll jsonb not null,
  unique(room_id, token_id)
);
create index if not exists room_combatants_order_idx on room_combatants(room_id, position);
create index if not exists room_combatants_token_id_idx on room_combatants(token_id);
