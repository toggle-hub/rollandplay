-- A door opened at the table is open in that room only; the saved map keeps its doors closed.
alter table room_map_structure_states add column if not exists is_open boolean not null default false;
