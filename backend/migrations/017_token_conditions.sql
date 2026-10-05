-- Conditions on a token (prone, poisoned, concentrating or the game master's own words), shown to the whole table.
alter table room_tokens add column if not exists conditions text[] not null default '{}';
