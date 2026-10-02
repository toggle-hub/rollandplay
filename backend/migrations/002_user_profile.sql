alter table users add column if not exists pronouns text not null default '';
alter table users add column if not exists profile_complete boolean not null default false;
