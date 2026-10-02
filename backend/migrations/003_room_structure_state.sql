create table if not exists room_map_structure_states(
  room_map_id uuid not null references room_maps(id) on delete cascade,
  structure_id uuid not null references map_structures(id) on delete cascade,
  geometry jsonb,
  is_hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(room_map_id, structure_id)
);

create index if not exists room_map_structure_states_structure_id_idx on room_map_structure_states(structure_id);
