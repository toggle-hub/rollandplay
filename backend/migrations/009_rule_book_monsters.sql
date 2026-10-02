-- Rule books carry monster templates: {id, name, description, size_m, stats}. Placing one in a
-- room copies its stats into the new token's attributes (game masters only).
alter table rule_books add column if not exists monsters jsonb not null default '[]'::jsonb;

-- The npc templates table was never exposed by the API; monsters on rule books replace it.
alter table room_tokens drop column if exists npc_id;
drop table if exists npcs;

-- Twelve low-level monsters from the System Reference Document 5.1 (CC BY 4.0, see README),
-- seeded only while the built-in book has none. Expertise (e.g. goblin Stealth +6) is not
-- modelled: skill flags add the proficiency bonus once.
update rule_books set monsters = '[
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
]'::jsonb
where id = '00000000-0000-4000-8000-000000000005' and monsters = '[]'::jsonb;
