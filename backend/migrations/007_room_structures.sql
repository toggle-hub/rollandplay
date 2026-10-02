-- Structures a game master places during play belong to one room map and never to the source map.
alter table map_structures add column if not exists room_map_id uuid references room_maps(id) on delete cascade;
create index if not exists map_structures_room_map_id_idx on map_structures(room_map_id);

-- A map structure removed during play stays in the source map and is hidden from that room only.
alter table room_map_structure_states add column if not exists is_removed boolean not null default false;
