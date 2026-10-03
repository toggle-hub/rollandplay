-- Vision is a full circle around each token; the cone angle is gone.
alter table room_tokens drop column if exists vision_angle_deg;
-- Optional uploaded image drawn inside the token.
alter table room_tokens add column if not exists image_asset_id uuid references assets(id) on delete set null;
create index if not exists room_tokens_image_asset_id_idx on room_tokens(image_asset_id);
-- Players the game master lets move a token, besides its owner.
create table if not exists room_token_movers(
  token_id uuid not null references room_tokens(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key(token_id,user_id)
);
create index if not exists room_token_movers_user_id_idx on room_token_movers(user_id);
