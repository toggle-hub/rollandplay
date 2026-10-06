-- The built-in D&D book allows the standard ancestry increase on top of the 27-point buy: three
-- bonus points, at most +2 on one ability (+2/+1, or +1/+1/+1). Applied only while no allowance is set.
update rule_books
set creation_rules = jsonb_set(creation_rules, '{point_buy}', creation_rules->'point_buy' || '{"bonus_budget":3,"bonus_max":2}'::jsonb)
where id = '00000000-0000-4000-8000-000000000005'
  and jsonb_typeof(creation_rules->'point_buy') = 'object'
  and (creation_rules->'point_buy'->>'bonus_budget')::int = 0;

-- Each built-in class names the compendium spells on its SRD 5.1 class spell list (CC BY 4.0, see
-- README) as `spell_list`, so character creation offers only those. Classes without spells get an
-- empty list. Added only while no class has a spell list yet.
update rule_books set creation_rules = jsonb_set(creation_rules, '{classes}', (
  select jsonb_agg(case when spells.ids is null then e.c else e.c || jsonb_build_object('spell_list', spells.ids) end order by e.ord)
  from jsonb_array_elements(creation_rules->'classes') with ordinality as e(c, ord)
  left join (values
    ('barbarian', '[]'::jsonb),
    ('bard', '["vicious_mockery", "cure_wounds", "healing_word", "thunderwave", "shatter"]'::jsonb),
    ('cleric', '["sacred_flame", "cure_wounds", "guiding_bolt", "healing_word", "inflict_wounds"]'::jsonb),
    ('druid', '["poison_spray", "produce_flame", "cure_wounds", "healing_word", "thunderwave"]'::jsonb),
    ('fighter', '[]'::jsonb),
    ('monk', '[]'::jsonb),
    ('paladin', '["cure_wounds"]'::jsonb),
    ('ranger', '["cure_wounds"]'::jsonb),
    ('rogue', '[]'::jsonb),
    ('sorcerer', '["acid_splash", "chill_touch", "fire_bolt", "poison_spray", "ray_of_frost", "shocking_grasp", "burning_hands", "thunderwave", "shatter", "fireball"]'::jsonb),
    ('warlock', '["chill_touch", "eldritch_blast", "poison_spray", "shatter"]'::jsonb),
    ('wizard', '["acid_splash", "chill_touch", "fire_bolt", "poison_spray", "ray_of_frost", "shocking_grasp", "burning_hands", "thunderwave", "shatter", "fireball"]'::jsonb)
  ) as spells(id, ids) on spells.id = e.c->>'id'))
where id = '00000000-0000-4000-8000-000000000005'
  and jsonb_typeof(creation_rules->'classes') = 'array'
  and not exists (select 1 from jsonb_array_elements(creation_rules->'classes') c where c ? 'spell_list')
  and jsonb_typeof(compendium->'actions') = 'array'
  and (select count(*) from jsonb_array_elements(compendium->'actions') a where a->>'id' in (
    'acid_splash', 'chill_touch', 'eldritch_blast', 'fire_bolt', 'poison_spray', 'produce_flame', 'ray_of_frost', 'sacred_flame', 'shocking_grasp',
    'vicious_mockery', 'burning_hands', 'cure_wounds', 'guiding_bolt', 'healing_word', 'inflict_wounds', 'thunderwave', 'shatter', 'fireball')) = 18;
