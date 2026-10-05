-- Rule books carry a compendium of weapons (attacks), spells and abilities (actions) and items, in
-- the shapes a sheet stores. Classes can name starting equipment from it; character creation offers it.
alter table rule_books add column if not exists compendium jsonb not null default '{"attacks": [], "actions": [], "items": []}'::jsonb check (jsonb_typeof(compendium) = 'object');

-- The order of a json (not jsonb) value, which still keeps its keys as written.
create or replace function pg_temp.json_key_order(value json) returns jsonb language plpgsql immutable as $$
declare
  result jsonb;
begin
  if json_typeof(value) = 'object' then
    select case when count(*) > 0 then jsonb_strip_nulls(jsonb_build_object(
        'keys', jsonb_agg(key order by position),
        'children', jsonb_object_agg(key, child) filter (where child is not null)))
      end into result
      from (select e.key, e.position, pg_temp.json_key_order(e.value) as child
            from json_each(value) with ordinality as e(key, value, position)) entries;
  elsif json_typeof(value) = 'array' then
    select case when bool_or(child is not null) then jsonb_build_object('items', jsonb_agg(child order by position)) end into result
      from (select e.position, pg_temp.json_key_order(e.value) as child
            from json_array_elements(value) with ordinality as e(value, position)) items;
  end if;
  return result;
end $$;

-- Weapons, spells and consumables from the System Reference Document 5.1 (CC BY 4.0, see README), seeded only while the built-in book's compendium is empty.
with seed as (select '{
  "attacks": [
    {
      "id": "club",
      "name": "Club",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "dagger",
      "name": "Dagger",
      "range_m": 1.5,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "dagger_thrown",
      "name": "Dagger (thrown)",
      "range_m": 6,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "greatclub",
      "name": "Greatclub",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "handaxe",
      "name": "Handaxe",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "handaxe_thrown",
      "name": "Handaxe (thrown)",
      "range_m": 6,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "javelin",
      "name": "Javelin",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "javelin_thrown",
      "name": "Javelin (thrown)",
      "range_m": 9,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "light_hammer",
      "name": "Light hammer",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "light_hammer_thrown",
      "name": "Light hammer (thrown)",
      "range_m": 6,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "mace",
      "name": "Mace",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "quarterstaff",
      "name": "Quarterstaff",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "sickle",
      "name": "Sickle",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "spear",
      "name": "Spear",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "spear_thrown",
      "name": "Spear (thrown)",
      "range_m": 6,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "light_crossbow",
      "name": "Light crossbow",
      "range_m": 24,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "dart",
      "name": "Dart",
      "range_m": 6,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "shortbow",
      "name": "Shortbow",
      "range_m": 24,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "sling",
      "name": "Sling",
      "range_m": 9,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "battleaxe",
      "name": "Battleaxe",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "flail",
      "name": "Flail",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "glaive",
      "name": "Glaive",
      "range_m": 3,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d10",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "greataxe",
      "name": "Greataxe",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d12",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "greatsword",
      "name": "Greatsword",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "2d6",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "halberd",
      "name": "Halberd",
      "range_m": 3,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d10",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "lance",
      "name": "Lance",
      "range_m": 3,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d12",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "longsword",
      "name": "Longsword",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "maul",
      "name": "Maul",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "2d6",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "morningstar",
      "name": "Morningstar",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "pike",
      "name": "Pike",
      "range_m": 3,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d10",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "rapier",
      "name": "Rapier",
      "range_m": 1.5,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "scimitar",
      "name": "Scimitar",
      "range_m": 1.5,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "shortsword",
      "name": "Shortsword",
      "range_m": 1.5,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "trident",
      "name": "Trident",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "trident_thrown",
      "name": "Trident (thrown)",
      "range_m": 6,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "war_pick",
      "name": "War pick",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "warhammer",
      "name": "Warhammer",
      "range_m": 1.5,
      "ability": "strength",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "bludgeoning"
    },
    {
      "id": "whip",
      "name": "Whip",
      "range_m": 3,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d4",
      "damage_bonus": 0,
      "damage_type": "slashing"
    },
    {
      "id": "blowgun",
      "name": "Blowgun",
      "range_m": 7.5,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "hand_crossbow",
      "name": "Hand crossbow",
      "range_m": 9,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d6",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "heavy_crossbow",
      "name": "Heavy crossbow",
      "range_m": 30,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d10",
      "damage_bonus": 0,
      "damage_type": "piercing"
    },
    {
      "id": "longbow",
      "name": "Longbow",
      "range_m": 45,
      "ability": "dexterity",
      "proficient": true,
      "attack_bonus": 0,
      "damage": "1d8",
      "damage_bonus": 0,
      "damage_type": "piercing"
    }
  ],
  "actions": [
    {
      "id": "acid_splash",
      "name": "Acid Splash",
      "kind": "save",
      "range_m": 18,
      "area_radius_m": 0,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "dexterity",
      "half_on_save": false,
      "dice": "1d6",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "acid"
    },
    {
      "id": "chill_touch",
      "name": "Chill Touch",
      "kind": "attack",
      "range_m": 36,
      "area_radius_m": 0,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d8",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "necrotic"
    },
    {
      "id": "eldritch_blast",
      "name": "Eldritch Blast",
      "kind": "attack",
      "range_m": 36,
      "area_radius_m": 0,
      "ability": "charisma",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d10",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "force"
    },
    {
      "id": "fire_bolt",
      "name": "Fire Bolt",
      "kind": "attack",
      "range_m": 36,
      "area_radius_m": 0,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d10",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "fire"
    },
    {
      "id": "poison_spray",
      "name": "Poison Spray",
      "kind": "save",
      "range_m": 3,
      "area_radius_m": 0,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "constitution",
      "half_on_save": false,
      "dice": "1d12",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "poison"
    },
    {
      "id": "produce_flame",
      "name": "Produce Flame",
      "kind": "attack",
      "range_m": 9,
      "area_radius_m": 0,
      "ability": "wisdom",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d8",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "fire"
    },
    {
      "id": "ray_of_frost",
      "name": "Ray of Frost",
      "kind": "attack",
      "range_m": 18,
      "area_radius_m": 0,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d8",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "cold"
    },
    {
      "id": "sacred_flame",
      "name": "Sacred Flame",
      "kind": "save",
      "range_m": 18,
      "area_radius_m": 0,
      "ability": "wisdom",
      "proficient": true,
      "bonus": 0,
      "save_ability": "dexterity",
      "half_on_save": false,
      "dice": "1d8",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "radiant"
    },
    {
      "id": "shocking_grasp",
      "name": "Shocking Grasp",
      "kind": "attack",
      "range_m": 1.5,
      "area_radius_m": 0,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d8",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "lightning"
    },
    {
      "id": "vicious_mockery",
      "name": "Vicious Mockery",
      "kind": "save",
      "range_m": 18,
      "area_radius_m": 0,
      "ability": "charisma",
      "proficient": true,
      "bonus": 0,
      "save_ability": "wisdom",
      "half_on_save": false,
      "dice": "1d4",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "psychic"
    },
    {
      "id": "burning_hands",
      "name": "Burning Hands",
      "kind": "save",
      "range_m": 3,
      "area_radius_m": 2,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "dexterity",
      "half_on_save": true,
      "dice": "3d6",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "fire"
    },
    {
      "id": "cure_wounds",
      "name": "Cure Wounds",
      "kind": "heal",
      "range_m": 1.5,
      "area_radius_m": 0,
      "ability": "wisdom",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d8",
      "dice_bonus": 0,
      "ability_to_dice": true,
      "damage_type": ""
    },
    {
      "id": "guiding_bolt",
      "name": "Guiding Bolt",
      "kind": "attack",
      "range_m": 36,
      "area_radius_m": 0,
      "ability": "wisdom",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "4d6",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "radiant"
    },
    {
      "id": "healing_word",
      "name": "Healing Word",
      "kind": "heal",
      "range_m": 18,
      "area_radius_m": 0,
      "ability": "wisdom",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d4",
      "dice_bonus": 0,
      "ability_to_dice": true,
      "damage_type": ""
    },
    {
      "id": "inflict_wounds",
      "name": "Inflict Wounds",
      "kind": "attack",
      "range_m": 1.5,
      "area_radius_m": 0,
      "ability": "wisdom",
      "proficient": true,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "3d10",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "necrotic"
    },
    {
      "id": "thunderwave",
      "name": "Thunderwave",
      "kind": "save",
      "range_m": 2.5,
      "area_radius_m": 2,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "constitution",
      "half_on_save": true,
      "dice": "2d8",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "thunder"
    },
    {
      "id": "shatter",
      "name": "Shatter",
      "kind": "save",
      "range_m": 18,
      "area_radius_m": 3,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "constitution",
      "half_on_save": true,
      "dice": "3d8",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "thunder"
    },
    {
      "id": "fireball",
      "name": "Fireball",
      "kind": "save",
      "range_m": 45,
      "area_radius_m": 6,
      "ability": "intelligence",
      "proficient": true,
      "bonus": 0,
      "save_ability": "dexterity",
      "half_on_save": true,
      "dice": "8d6",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "fire"
    }
  ],
  "items": [
    {
      "id": "potion_of_healing",
      "name": "Potion of healing",
      "kind": "heal",
      "range_m": 1.5,
      "area_radius_m": 0,
      "ability": "",
      "proficient": false,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "2d4",
      "dice_bonus": 2,
      "ability_to_dice": false,
      "damage_type": "",
      "quantity": 1
    },
    {
      "id": "potion_of_greater_healing",
      "name": "Potion of greater healing",
      "kind": "heal",
      "range_m": 1.5,
      "area_radius_m": 0,
      "ability": "",
      "proficient": false,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "4d4",
      "dice_bonus": 4,
      "ability_to_dice": false,
      "damage_type": "",
      "quantity": 1
    },
    {
      "id": "acid_vial",
      "name": "Acid (vial)",
      "kind": "attack",
      "range_m": 6,
      "area_radius_m": 0,
      "ability": "dexterity",
      "proficient": false,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "2d6",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "acid",
      "quantity": 1
    },
    {
      "id": "alchemists_fire",
      "name": "Alchemist''s fire",
      "kind": "attack",
      "range_m": 6,
      "area_radius_m": 0,
      "ability": "dexterity",
      "proficient": false,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "1d4",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "fire",
      "quantity": 1
    },
    {
      "id": "holy_water",
      "name": "Holy water",
      "kind": "attack",
      "range_m": 6,
      "area_radius_m": 0,
      "ability": "dexterity",
      "proficient": false,
      "bonus": 0,
      "save_ability": "",
      "half_on_save": false,
      "dice": "2d6",
      "dice_bonus": 0,
      "ability_to_dice": false,
      "damage_type": "radiant",
      "quantity": 1
    }
  ]
}'::json as compendium)
update rule_books set compendium = seed.compendium::jsonb,
  key_order = rule_books.key_order || jsonb_build_object('compendium', pg_temp.json_key_order(seed.compendium))
from seed
where rule_books.id = '00000000-0000-4000-8000-000000000005'
  and rule_books.compendium = '{"attacks": [], "actions": [], "items": []}'::jsonb;

-- Each built-in class starts with the weapons from the first option of its SRD 5.1 starting
-- equipment choices, added only while no class has starting equipment yet.
update rule_books set creation_rules = jsonb_set(creation_rules, '{classes}', (
  select jsonb_agg(case when kit.attacks is null then e.c
    else e.c || jsonb_build_object('starting_equipment', jsonb_build_object('attacks', kit.attacks, 'actions', '[]'::jsonb, 'items', '[]'::jsonb)) end
    order by e.ord)
  from jsonb_array_elements(creation_rules->'classes') with ordinality as e(c, ord)
  left join (values
    ('barbarian', '["greataxe", "handaxe", "handaxe_thrown"]'::jsonb),
    ('bard', '["rapier", "dagger", "dagger_thrown"]'::jsonb),
    ('cleric', '["mace", "light_crossbow"]'::jsonb),
    ('druid', '["scimitar"]'::jsonb),
    ('fighter', '["longsword", "light_crossbow"]'::jsonb),
    ('monk', '["shortsword", "dart"]'::jsonb),
    ('paladin', '["longsword", "javelin", "javelin_thrown"]'::jsonb),
    ('ranger', '["shortsword", "longbow"]'::jsonb),
    ('rogue', '["rapier", "shortbow", "dagger", "dagger_thrown"]'::jsonb),
    ('sorcerer', '["light_crossbow", "dagger", "dagger_thrown"]'::jsonb),
    ('warlock', '["light_crossbow", "dagger", "dagger_thrown"]'::jsonb),
    ('wizard', '["quarterstaff"]'::jsonb)
  ) as kit(id, attacks) on kit.id = e.c->>'id'))
where id = '00000000-0000-4000-8000-000000000005'
  and jsonb_typeof(creation_rules->'classes') = 'array'
  and not exists (select 1 from jsonb_array_elements(creation_rules->'classes') c where c ? 'starting_equipment');
