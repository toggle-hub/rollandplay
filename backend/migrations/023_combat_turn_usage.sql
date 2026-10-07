-- What the current combatant has spent this turn. It counts only while turn_combatant_id and
-- turn_round match whose turn it is, so a new turn starts fresh.
alter table room_combats add column if not exists turn_combatant_id uuid;
alter table room_combats add column if not exists turn_round int not null default 0;
alter table room_combats add column if not exists turn_actions_used int not null default 0;
alter table room_combats add column if not exists turn_extra_actions int not null default 0;
alter table room_combats add column if not exists turn_moved_m double precision not null default 0;
