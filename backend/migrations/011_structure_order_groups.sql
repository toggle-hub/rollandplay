-- Draw order inside a map: a higher z_index draws on top.
alter table map_structures add column if not exists z_index integer not null default 0;
update map_structures ms set z_index = ordered.position
  from (select id, row_number() over (partition by map_id order by created_at, id) as position from map_structures) ordered
  where ms.id = ordered.id;
-- Editor groups: structures sharing a group_id are selected and transformed together.
alter table map_structures add column if not exists group_id uuid;
create index if not exists map_structures_group_id_idx on map_structures(group_id);
