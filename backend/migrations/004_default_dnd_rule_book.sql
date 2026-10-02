-- A NULL owner identifies a built-in rule book, without creating a system user.
alter table rule_books alter column owner_id drop not null;

-- HP stays unconfigured at zero until the player chooses class and level values.
insert into rule_books(id, owner_id, name, is_public, attributes)
values (
  '00000000-0000-4000-8000-000000000005',
  null,
  'D&D 5e (2014)',
  true,
  '{
    "strength": 10,
    "dexterity": 10,
    "constitution": 10,
    "intelligence": 10,
    "wisdom": 10,
    "charisma": 10,
    "level": 1,
    "proficiency_bonus": 2,
    "armor_class": 10,
    "initiative": 0,
    "speed_m": 9,
    "hit_points": 0,
    "max_hit_points": 0,
    "temporary_hit_points": 0,
    "inspiration": false,
    "death_save_successes": 0,
    "death_save_failures": 0,
    "saving_throw_proficiencies": {
      "strength": false,
      "dexterity": false,
      "constitution": false,
      "intelligence": false,
      "wisdom": false,
      "charisma": false
    },
    "skill_proficiencies": {
      "acrobatics": false,
      "animal_handling": false,
      "arcana": false,
      "athletics": false,
      "deception": false,
      "history": false,
      "insight": false,
      "intimidation": false,
      "investigation": false,
      "medicine": false,
      "nature": false,
      "perception": false,
      "performance": false,
      "persuasion": false,
      "religion": false,
      "sleight_of_hand": false,
      "stealth": false,
      "survival": false
    }
  }'::jsonb
)
on conflict(id) do nothing;
