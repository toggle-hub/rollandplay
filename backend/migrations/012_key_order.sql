-- Postgres jsonb (and Go maps) drop object key order, so rule books and sheets store the order
-- their author wrote next to the data: key_order is {field: order}, where an object's order is
-- {"keys": [...], "children": {key: order}} and an array's is {"items": [order or null, ...]}.
-- Clients re-apply it when displaying the data.
alter table rule_books add column if not exists key_order jsonb not null default '{}'::jsonb check (jsonb_typeof(key_order) = 'object');
alter table sheets add column if not exists key_order jsonb not null default '{}'::jsonb check (jsonb_typeof(key_order) = 'object');

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

-- The built-in book's order, rebuilt from the seed text of migrations 004, 005 and 009. Each part
-- is only recorded while the stored value still equals its seed.
with class_seed(id, name, hit_die, saves, skills, picks) as (
 values
 ('barbarian', 'Barbarian', 12, array['strength','constitution'], array['animal_handling','athletics','intimidation','nature','perception','survival'], 2),
 ('bard', 'Bard', 8, array['dexterity','charisma'], array['acrobatics','animal_handling','arcana','athletics','deception','history','insight','intimidation','investigation','medicine','nature','perception','performance','persuasion','religion','sleight_of_hand','stealth','survival'], 3),
 ('cleric', 'Cleric', 8, array['wisdom','charisma'], array['history','insight','medicine','persuasion','religion'], 2),
 ('druid', 'Druid', 8, array['intelligence','wisdom'], array['arcana','animal_handling','insight','medicine','nature','perception','religion','survival'], 2),
 ('fighter', 'Fighter', 10, array['strength','constitution'], array['acrobatics','animal_handling','athletics','history','insight','intimidation','perception','survival'], 2),
 ('monk', 'Monk', 8, array['strength','dexterity'], array['acrobatics','athletics','history','insight','religion','stealth'], 2),
 ('paladin', 'Paladin', 10, array['wisdom','charisma'], array['athletics','insight','intimidation','medicine','persuasion','religion'], 2),
 ('ranger', 'Ranger', 10, array['strength','dexterity'], array['animal_handling','athletics','insight','investigation','nature','perception','stealth','survival'], 3),
 ('rogue', 'Rogue', 8, array['dexterity','intelligence'], array['acrobatics','athletics','deception','insight','intimidation','investigation','perception','performance','persuasion','sleight_of_hand','stealth'], 4),
 ('sorcerer', 'Sorcerer', 6, array['constitution','charisma'], array['arcana','deception','insight','intimidation','persuasion','religion'], 2),
 ('warlock', 'Warlock', 8, array['wisdom','charisma'], array['arcana','deception','history','intimidation','investigation','nature','religion'], 2),
 ('wizard', 'Wizard', 6, array['intelligence','wisdom'], array['arcana','history','insight','investigation','medicine','religion'], 2)
), rules as (
 select json_build_object(
  'classes', json_agg(json_build_object(
   'id', id, 'name', name,
   'defaults', json_build_object('hit_die', hit_die, 'saving_throw_proficiencies', (
    select json_object_agg(ability, ability = any(saves) order by position)
    from unnest(array['strength','dexterity','constitution','intelligence','wisdom','charisma']) with ordinality as a(ability, position)
   )),
   'choices', json_build_array(json_build_object('attribute','skill_proficiencies','label','Class skill proficiencies','count',picks,'options',to_json(skills)))
  ) order by name),
  'point_buy', '{"attributes":["strength","dexterity","constitution","intelligence","wisdom","charisma"],"min":8,"max":15,"budget":27,"costs":{"8":0,"9":1,"10":2,"11":3,"12":4,"13":5,"14":7,"15":9},"bonus_budget":0,"bonus_max":0}'::json
 ) as value from class_seed
), seeds as (
 select '{
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
  }'::json as attributes, (select value from rules) as creation_rules, '[
  {
    "id": "bandit",
    "name": "Bandit",
    "description": "Medium humanoid, any non-lawful alignment. CR 1/8 (25 XP).",
    "size_m": 1.5,
    "stats": {
      "strength": 11,
      "dexterity": 12,
      "constitution": 12,
      "intelligence": 10,
      "wisdom": 10,
      "charisma": 10,
      "armor_class": 12,
      "hit_points": 11,
      "max_hit_points": 11,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {},
      "attacks": [
        {
          "id": "scimitar",
          "name": "Scimitar",
          "range_m": 1.5,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        },
        {
          "id": "light_crossbow",
          "name": "Light crossbow",
          "range_m": 24,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d8",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "bugbear",
    "name": "Bugbear",
    "description": "Medium humanoid (goblinoid), chaotic evil. CR 1 (200 XP). Brute: melee weapons deal one extra die (included). Surprise Attack: +2d6 damage against a surprised creature in the first round. SRD Stealth is +6 (expertise); checks here use proficiency only.",
    "size_m": 1.5,
    "stats": {
      "strength": 15,
      "dexterity": 14,
      "constitution": 13,
      "intelligence": 8,
      "wisdom": 11,
      "charisma": 9,
      "armor_class": 16,
      "hit_points": 27,
      "max_hit_points": 27,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {
        "stealth": true,
        "survival": true
      },
      "attacks": [
        {
          "id": "morningstar",
          "name": "Morningstar",
          "range_m": 1.5,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "2d8",
          "damage_bonus": 0
        },
        {
          "id": "javelin",
          "name": "Javelin (thrown)",
          "range_m": 9,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "giant_rat",
    "name": "Giant rat",
    "description": "Small beast, unaligned. CR 1/8 (25 XP). Keen Smell; Pack Tactics: advantage when an ally is within 1.5 m of the target.",
    "size_m": 1.5,
    "stats": {
      "strength": 7,
      "dexterity": 15,
      "constitution": 11,
      "intelligence": 2,
      "wisdom": 10,
      "charisma": 4,
      "armor_class": 12,
      "hit_points": 7,
      "max_hit_points": 7,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {},
      "attacks": [
        {
          "id": "bite",
          "name": "Bite",
          "range_m": 1.5,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d4",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "gnoll",
    "name": "Gnoll",
    "description": "Medium humanoid (gnoll), chaotic evil. CR 1/2 (100 XP). Rampage: after reducing a creature to 0 HP with a melee attack, it can move half its speed and bite as a bonus action.",
    "size_m": 1.5,
    "stats": {
      "strength": 14,
      "dexterity": 12,
      "constitution": 11,
      "intelligence": 6,
      "wisdom": 10,
      "charisma": 7,
      "armor_class": 15,
      "hit_points": 22,
      "max_hit_points": 22,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {},
      "attacks": [
        {
          "id": "bite",
          "name": "Bite",
          "range_m": 1.5,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d4",
          "damage_bonus": 0
        },
        {
          "id": "spear",
          "name": "Spear",
          "range_m": 1.5,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        },
        {
          "id": "longbow",
          "name": "Longbow",
          "range_m": 45,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d8",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "goblin",
    "name": "Goblin",
    "description": "Small humanoid (goblinoid), neutral evil. CR 1/4 (50 XP). Nimble Escape: Disengage or Hide as a bonus action. SRD Stealth is +6 (expertise); checks here use proficiency only.",
    "size_m": 1.5,
    "stats": {
      "strength": 8,
      "dexterity": 14,
      "constitution": 10,
      "intelligence": 10,
      "wisdom": 8,
      "charisma": 8,
      "armor_class": 15,
      "hit_points": 7,
      "max_hit_points": 7,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {
        "stealth": true
      },
      "attacks": [
        {
          "id": "scimitar",
          "name": "Scimitar",
          "range_m": 1.5,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        },
        {
          "id": "shortbow",
          "name": "Shortbow",
          "range_m": 24,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "hobgoblin",
    "name": "Hobgoblin",
    "description": "Medium humanoid (goblinoid), lawful evil. CR 1/2 (100 XP). Martial Advantage: once per turn, +2d6 damage when an ally is within 1.5 m of the target.",
    "size_m": 1.5,
    "stats": {
      "strength": 13,
      "dexterity": 12,
      "constitution": 12,
      "intelligence": 10,
      "wisdom": 10,
      "charisma": 9,
      "armor_class": 18,
      "hit_points": 11,
      "max_hit_points": 11,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {},
      "attacks": [
        {
          "id": "longsword",
          "name": "Longsword",
          "range_m": 1.5,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d8",
          "damage_bonus": 0
        },
        {
          "id": "longbow",
          "name": "Longbow",
          "range_m": 45,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d8",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "kobold",
    "name": "Kobold",
    "description": "Small humanoid (kobold), lawful evil. CR 1/8 (25 XP). Sunlight Sensitivity; Pack Tactics: advantage when an ally is within 1.5 m of the target.",
    "size_m": 1.5,
    "stats": {
      "strength": 7,
      "dexterity": 15,
      "constitution": 9,
      "intelligence": 8,
      "wisdom": 7,
      "charisma": 8,
      "armor_class": 12,
      "hit_points": 5,
      "max_hit_points": 5,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {},
      "attacks": [
        {
          "id": "dagger",
          "name": "Dagger",
          "range_m": 1.5,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d4",
          "damage_bonus": 0
        },
        {
          "id": "sling",
          "name": "Sling",
          "range_m": 9,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d4",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "ogre",
    "name": "Ogre",
    "description": "Large giant, chaotic evil. CR 2 (450 XP).",
    "size_m": 3,
    "stats": {
      "strength": 19,
      "dexterity": 8,
      "constitution": 16,
      "intelligence": 5,
      "wisdom": 7,
      "charisma": 7,
      "armor_class": 11,
      "hit_points": 59,
      "max_hit_points": 59,
      "speed_m": 12,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {},
      "attacks": [
        {
          "id": "greatclub",
          "name": "Greatclub",
          "range_m": 1.5,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "2d8",
          "damage_bonus": 0
        },
        {
          "id": "javelin",
          "name": "Javelin (thrown)",
          "range_m": 9,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "2d6",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "orc",
    "name": "Orc",
    "description": "Medium humanoid (orc), chaotic evil. CR 1/2 (100 XP). Aggressive: as a bonus action, moves up to its speed toward a hostile creature it can see.",
    "size_m": 1.5,
    "stats": {
      "strength": 16,
      "dexterity": 12,
      "constitution": 16,
      "intelligence": 7,
      "wisdom": 11,
      "charisma": 10,
      "armor_class": 13,
      "hit_points": 15,
      "max_hit_points": 15,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {
        "intimidation": true
      },
      "attacks": [
        {
          "id": "greataxe",
          "name": "Greataxe",
          "range_m": 1.5,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d12",
          "damage_bonus": 0
        },
        {
          "id": "javelin",
          "name": "Javelin (thrown)",
          "range_m": 9,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "skeleton",
    "name": "Skeleton",
    "description": "Medium undead, lawful evil. CR 1/4 (50 XP). Vulnerable to bludgeoning; immune to poison and exhaustion.",
    "size_m": 1.5,
    "stats": {
      "strength": 10,
      "dexterity": 14,
      "constitution": 15,
      "intelligence": 6,
      "wisdom": 8,
      "charisma": 5,
      "armor_class": 13,
      "hit_points": 13,
      "max_hit_points": 13,
      "speed_m": 9,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {},
      "attacks": [
        {
          "id": "shortsword",
          "name": "Shortsword",
          "range_m": 1.5,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        },
        {
          "id": "shortbow",
          "name": "Shortbow",
          "range_m": 24,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "wolf",
    "name": "Wolf",
    "description": "Medium beast, unaligned. CR 1/4 (50 XP). Keen Hearing and Smell; Pack Tactics. A creature hit by its bite must succeed on a DC 11 Strength saving throw or be knocked prone.",
    "size_m": 1.5,
    "stats": {
      "strength": 12,
      "dexterity": 15,
      "constitution": 12,
      "intelligence": 3,
      "wisdom": 12,
      "charisma": 6,
      "armor_class": 13,
      "hit_points": 11,
      "max_hit_points": 11,
      "speed_m": 12,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {},
      "skill_proficiencies": {
        "perception": true,
        "stealth": true
      },
      "attacks": [
        {
          "id": "bite",
          "name": "Bite",
          "range_m": 1.5,
          "ability": "dexterity",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "2d4",
          "damage_bonus": 0
        }
      ]
    }
  },
  {
    "id": "zombie",
    "name": "Zombie",
    "description": "Medium undead, neutral evil. CR 1/4 (50 XP). Undead Fortitude: when reduced to 0 HP by non-radiant damage that is not a critical hit, it makes a Constitution save (DC 5 + damage taken) to drop to 1 HP instead.",
    "size_m": 1.5,
    "stats": {
      "strength": 13,
      "dexterity": 6,
      "constitution": 16,
      "intelligence": 3,
      "wisdom": 6,
      "charisma": 5,
      "armor_class": 8,
      "hit_points": 22,
      "max_hit_points": 22,
      "speed_m": 6,
      "proficiency_bonus": 2,
      "saving_throw_proficiencies": {
        "wisdom": true
      },
      "skill_proficiencies": {},
      "attacks": [
        {
          "id": "slam",
          "name": "Slam",
          "range_m": 1.5,
          "ability": "strength",
          "proficient": true,
          "attack_bonus": 0,
          "damage": "1d6",
          "damage_bonus": 0
        }
      ]
    }
  }
]'::json as monsters
)
update rule_books set key_order = rule_books.key_order || jsonb_strip_nulls(jsonb_build_object(
  'attributes', case when rule_books.attributes = seeds.attributes::jsonb then pg_temp.json_key_order(seeds.attributes) end,
  'creation_rules', case when rule_books.creation_rules = seeds.creation_rules::jsonb then pg_temp.json_key_order(seeds.creation_rules) end,
  'monsters', case when rule_books.monsters = seeds.monsters::jsonb then pg_temp.json_key_order(seeds.monsters) end))
from seeds
where rule_books.id = '00000000-0000-4000-8000-000000000005';

-- Existing characters were created from their book's defaults, so they follow the book's attribute order.
update sheets set key_order = jsonb_build_object('data', rule_books.key_order->'attributes')
from rule_books
where rule_books.id = sheets.rule_book_id and sheets.key_order = '{}'::jsonb and rule_books.key_order ? 'attributes';
