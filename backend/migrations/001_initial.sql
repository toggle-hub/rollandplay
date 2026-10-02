create extension if not exists citext;

create table if not exists users(
  id uuid primary key,
  username text not null unique,
  email citext not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists auth_magic_links(
  id uuid primary key,
  email citext not null,
  user_id uuid references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists sessions(
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists friends(
  id uuid primary key,
  requester_user_id uuid not null references users(id) on delete cascade,
  addressee_user_id uuid not null references users(id) on delete cascade,
  status text not null check(status in ('pending','accepted','blocked')),
  blocked_by_user_id uuid references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(requester_user_id <> addressee_user_id),
  check((status = 'blocked') = (blocked_by_user_id is not null)),
  check(blocked_by_user_id is null or blocked_by_user_id in (requester_user_id, addressee_user_id))
);
create table if not exists rule_books(
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  is_public boolean not null default false,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists rule_book_editors(
  rule_book_id uuid not null references rule_books(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key(rule_book_id,user_id)
);
create table if not exists sheets(
  id uuid primary key,
  rule_book_id uuid not null references rule_books(id) on delete restrict,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists rooms(
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  is_public boolean not null default false,
  password_hash text,
  name text not null,
  invite_code text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists room_members(
  id uuid primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  sheet_id uuid references sheets(id) on delete set null,
  is_dm boolean not null default false,
  joined_at timestamptz not null default now(),
  unique(room_id,user_id)
);
create table if not exists assets(
  id uuid primary key,
  owner_id uuid references users(id) on delete set null,
  name text not null,
  kind text not null check(kind in ('map_background','token','structure','portrait','site')),
  mime_type text not null,
  byte_size bigint not null,
  storage_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists maps(
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  is_public boolean not null default false,
  name text not null,
  width_m numeric(10,2) not null default 30,
  height_m numeric(10,2) not null default 30,
  grid_size_m numeric(10,2) not null default 1,
  background_asset_id uuid references assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists map_editors(
  map_id uuid not null references maps(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key(map_id,user_id)
);
create table if not exists map_structures(
  id uuid primary key,
  map_id uuid not null references maps(id) on delete cascade,
  kind text not null check(kind in ('wall','window','door','terrain','cover')),
  geometry jsonb not null,
  blocks_vision boolean not null default false,
  blocks_movement boolean not null default false,
  blocks_attacks boolean not null default false,
  cover_bonus integer not null default 0,
  pass_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists room_maps(
  id uuid primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  map_id uuid not null references maps(id) on delete restrict,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique(room_id,map_id)
);
create unique index if not exists room_maps_one_active on room_maps(room_id) where is_active;
create table if not exists npcs(
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  rule_book_id uuid references rule_books(id) on delete set null,
  name text not null,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists room_tokens(
  id uuid primary key,
  room_map_id uuid not null references room_maps(id) on delete cascade,
  sheet_id uuid references sheets(id) on delete set null,
  npc_id uuid references npcs(id) on delete set null,
  owner_user_id uuid references users(id) on delete set null,
  name text not null,
  x_m numeric(10,2) not null,
  y_m numeric(10,2) not null,
  rotation_deg numeric(6,2) not null default 0,
  size_m numeric(10,2) not null default 1,
  vision_range_m numeric(10,2) not null default 12,
  vision_angle_deg numeric(6,2) not null default 90,
  is_hidden boolean not null default false,
  attributes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check((sheet_id is not null)::int + (npc_id is not null)::int <= 1)
);
create table if not exists chat_messages(
  id uuid primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  sender_user_id uuid references users(id) on delete set null,
  kind text not null check(kind in ('chat','dm','roll','system')),
  body text not null,
  roll jsonb,
  created_at timestamptz not null default now()
);
create table if not exists chat_message_recipients(
  message_id uuid not null references chat_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key(message_id,user_id)
);
create table if not exists loot_possibilities(
  id uuid primary key,
  owner_id uuid not null references users(id) on delete cascade,
  rule_book_id uuid references rule_books(id) on delete set null,
  name text not null,
  table_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists auth_magic_links_user_id_idx on auth_magic_links(user_id);
create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists friends_requester_idx on friends(requester_user_id);
create index if not exists friends_addressee_idx on friends(addressee_user_id);
create index if not exists friends_addressee_status_idx on friends(addressee_user_id, status);
create index if not exists friends_requester_status_idx on friends(requester_user_id, status);
create unique index if not exists friends_unique_pair on friends(least(requester_user_id, addressee_user_id), greatest(requester_user_id, addressee_user_id));
create index if not exists rule_books_owner_id_idx on rule_books(owner_id);
create index if not exists rule_book_editors_user_id_idx on rule_book_editors(user_id);
create index if not exists sheets_rule_book_id_idx on sheets(rule_book_id);
create index if not exists sheets_user_id_idx on sheets(user_id);
create index if not exists rooms_owner_id_idx on rooms(owner_id);
create index if not exists rooms_invite_code_idx on rooms(invite_code);
create index if not exists room_members_room_id_idx on room_members(room_id);
create index if not exists room_members_user_id_idx on room_members(user_id);
create index if not exists assets_owner_id_idx on assets(owner_id);
create index if not exists maps_owner_id_idx on maps(owner_id);
create index if not exists maps_background_asset_id_idx on maps(background_asset_id);
create index if not exists map_editors_user_id_idx on map_editors(user_id);
create index if not exists map_structures_map_id_idx on map_structures(map_id);
create index if not exists room_maps_room_id_idx on room_maps(room_id);
create index if not exists room_maps_map_id_idx on room_maps(map_id);
create index if not exists npcs_owner_id_idx on npcs(owner_id);
create index if not exists npcs_rule_book_id_idx on npcs(rule_book_id);
create index if not exists room_tokens_room_map_id_idx on room_tokens(room_map_id);
create index if not exists room_tokens_sheet_id_idx on room_tokens(sheet_id);
create index if not exists room_tokens_npc_id_idx on room_tokens(npc_id);
create index if not exists room_tokens_owner_user_id_idx on room_tokens(owner_user_id);
create index if not exists chat_messages_room_created_idx on chat_messages(room_id, created_at);
create index if not exists chat_messages_sender_user_id_idx on chat_messages(sender_user_id);
create index if not exists chat_message_recipients_user_id_idx on chat_message_recipients(user_id);
create index if not exists loot_possibilities_owner_id_idx on loot_possibilities(owner_id);
create index if not exists loot_possibilities_rule_book_id_idx on loot_possibilities(rule_book_id);
