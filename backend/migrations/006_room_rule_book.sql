-- Every room plays with one rule book; invites carry it so players can bring a matching character.
-- Existing rooms adopt the built-in D&D book installed by migration 004.
alter table rooms add column if not exists rule_book_id uuid references rule_books(id) on delete restrict;
update rooms set rule_book_id = '00000000-0000-4000-8000-000000000005' where rule_book_id is null;
alter table rooms alter column rule_book_id set not null;
create index if not exists rooms_rule_book_id_idx on rooms(rule_book_id);
