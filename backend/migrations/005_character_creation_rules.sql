alter table rule_books add column if not exists creation_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(creation_rules) = 'object');
alter table sheets add column if not exists creation jsonb not null default '{}'::jsonb check (jsonb_typeof(creation) = 'object');

-- Class creation data adapted from SRD 5.1 (CC BY 4.0); attribution in README.
-- The 2014 point-buy variant is before ancestry bonuses. No universal ancestry
-- allowance exists: custom/extended books may configure their own bonus pool.
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
), configured as (
 select jsonb_agg(jsonb_build_object(
  'id', id, 'name', name,
  'defaults', jsonb_build_object('hit_die', hit_die, 'saving_throw_proficiencies', (
   select jsonb_object_agg(ability, ability = any(saves))
   from unnest(array['strength','dexterity','constitution','intelligence','wisdom','charisma']) as ability
  )),
  'choices', jsonb_build_array(jsonb_build_object('attribute','skill_proficiencies','label','Class skill proficiencies','count',picks,'options',to_jsonb(skills)))
 ) order by name) as classes from class_seed
)
update rule_books set creation_rules = jsonb_build_object(
 'classes', configured.classes,
 'point_buy', '{"attributes":["strength","dexterity","constitution","intelligence","wisdom","charisma"],"min":8,"max":15,"budget":27,"costs":{"8":0,"9":1,"10":2,"11":3,"12":4,"13":5,"14":7,"15":9},"bonus_budget":0,"bonus_max":0}'::jsonb
)
from configured
where rule_books.id = '00000000-0000-4000-8000-000000000005' and rule_books.creation_rules = '{}'::jsonb;
