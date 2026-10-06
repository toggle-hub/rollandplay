package httpapi

import (
	"encoding/json"
	"reflect"
	"testing"

	"rollandplay/backend/internal/game"
)

const customCreationRules = `{"classes":[{"id":"mage","name":"Mage","defaults":{"hit_die":6},"choices":[{"attribute":"skills","label":"Training","count":1,"options":["arcana","nature"]}]}],"point_buy":{"attributes":["focus","grit"],"min":0,"max":3,"budget":6,"costs":{"0":0,"1":1,"2":3,"3":5},"bonus_budget":1,"bonus_max":1}}`
const validCreation = `{"class_id":"mage","scores":{"focus":3,"grit":1},"bonuses":{"focus":1},"choices":{"skills":["arcana"]}}`

func TestCreationAppliesClassChoicesAndSeparateBonuses(t *testing.T) {
	attributes := map[string]any{"focus": float64(0), "skills": map[string]any{"arcana": false, "nature": false, "quiet": true}}
	rules, err := parseCreationRules(json.RawMessage(customCreationRules), attributes, game.Compendium{})
	if err != nil {
		t.Fatal(err)
	}
	data, creation, err := applyCharacterCreation(attributes, rules, map[string]any{"active": false}, json.RawMessage(validCreation))
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]any{"focus": float64(4), "grit": float64(1), "hit_die": float64(6), "class": "Mage", "active": false, "skills": map[string]any{"arcana": true, "nature": false, "quiet": true}}
	if !reflect.DeepEqual(data, expected) {
		t.Fatalf("got %#v, want %#v", data, expected)
	}
	if creation.Scores["focus"] != float64(3) || attributes["skills"].(map[string]any)["arcana"] != false {
		t.Fatal("creation mutated source values")
	}
}

func TestCreationRejectsInvalidSelectionsAndJSONBypass(t *testing.T) {
	rules, err := parseCreationRules(json.RawMessage(customCreationRules), nil, game.Compendium{})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, creation string
		data           map[string]any
	}{
		{"missing class", `{"scores":{"focus":0,"grit":0}}`, nil},
		{"unknown class", `{"class_id":"rogue","scores":{"focus":0,"grit":0}}`, nil},
		{"overspend", `{"class_id":"mage","scores":{"focus":3,"grit":3},"choices":{"skills":["arcana"]}}`, nil},
		{"fractional score", `{"class_id":"mage","scores":{"focus":1.5,"grit":0},"choices":{"skills":["arcana"]}}`, nil},
		{"null score", `{"class_id":"mage","scores":{"focus":null,"grit":0},"choices":{"skills":["arcana"]}}`, nil},
		{"missing score", `{"class_id":"mage","scores":{"focus":0},"choices":{"skills":["arcana"]}}`, nil},
		{"unknown score", `{"class_id":"mage","scores":{"focus":0,"grit":0,"extra":0},"choices":{"skills":["arcana"]}}`, nil},
		{"out of range", `{"class_id":"mage","scores":{"focus":4,"grit":0},"choices":{"skills":["arcana"]}}`, nil},
		{"bonus budget", `{"class_id":"mage","scores":{"focus":0,"grit":0},"bonuses":{"focus":1,"grit":1},"choices":{"skills":["arcana"]}}`, nil},
		{"bonus cap", `{"class_id":"mage","scores":{"focus":0,"grit":0},"bonuses":{"focus":2},"choices":{"skills":["arcana"]}}`, nil},
		{"unknown bonus", `{"class_id":"mage","scores":{"focus":0,"grit":0},"bonuses":{"extra":1},"choices":{"skills":["arcana"]}}`, nil},
		{"ineligible skill", `{"class_id":"mage","scores":{"focus":0,"grit":0},"choices":{"skills":["stealth"]}}`, nil},
		{"extra choice group", `{"class_id":"mage","scores":{"focus":0,"grit":0},"choices":{"skills":["arcana"],"other":["stealth"]}}`, nil},
		{"too many skills", `{"class_id":"mage","scores":{"focus":0,"grit":0},"choices":{"skills":["arcana","nature"]}}`, nil},
		{"JSON score bypass", validCreation, map[string]any{"focus": float64(20)}},
		{"JSON class bypass", validCreation, map[string]any{"class": "Warrior"}},
		{"JSON grant bypass", validCreation, map[string]any{"hit_die": float64(12)}},
		{"JSON skill bypass", validCreation, map[string]any{"skills": map[string]any{"arcana": true, "nature": true}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := applyCharacterCreation(nil, rules, tc.data, json.RawMessage(tc.creation)); err == nil {
				t.Fatal("invalid creation accepted")
			}
		})
	}
	rules.Classes[0].Choices[0].Count = 2
	if _, _, err := applyCharacterCreation(nil, rules, nil, json.RawMessage(`{"class_id":"mage","scores":{"focus":0,"grit":0},"choices":{"skills":["arcana","arcana"]}}`)); err == nil {
		t.Fatal("duplicate picks accepted")
	}
}

func TestCreationRejectsInvalidRuleConfiguration(t *testing.T) {
	cases := []string{
		`{"classes":[{"id":"a","name":"A","defaults":{}},{"id":"a","name":"B","defaults":{}}]}`,
		`{"classes":[{"id":"a","name":"A","defaults":{"class":"B"}}]}`,
		`{"classes":[{"id":"a","name":"A","defaults":{},"choices":[{"attribute":"skills","label":"Skills","count":2,"options":["a"]}]}]}`,
		`{"point_buy":{"attributes":["score"],"min":0,"max":2,"budget":5,"costs":{"0":0,"2":2},"bonus_budget":0,"bonus_max":0}}`,
		`{"point_buy":{"attributes":["score"],"min":0,"max":1,"budget":5,"costs":{"0":0,"1":0},"bonus_budget":0,"bonus_max":0}}`,
		`{"point_buy":{"attributes":["score"],"min":0,"max":1000,"budget":5,"costs":{},"bonus_budget":0,"bonus_max":0}}`,
		`{"point_buy":{"attributes":["score"],"min":0,"max":1,"budget":-1,"costs":{"0":0,"1":1},"bonus_budget":0,"bonus_max":0}}`,
		`{"point_buy":{"attributes":["class"],"min":0,"max":1,"budget":5,"costs":{"0":0,"1":1},"bonus_budget":0,"bonus_max":0}}`,
		`{"classes":[{"id":"a","name":"A","defaults":{"attacks":[]}}]}`,
		`{"classes":[{"id":"a","name":"A","defaults":{},"starting_equipment":{"attacks":["axe"]}}]}`,
	}
	for _, raw := range cases {
		if _, err := parseCreationRules(json.RawMessage(raw), nil, game.Compendium{}); err == nil {
			t.Fatalf("invalid configuration accepted: %s", raw)
		}
	}
}

func TestCreationAcceptsStartingEquipmentFromCompendium(t *testing.T) {
	compendium, err := game.ParseCompendium([]byte(`{"attacks":[{"id":"axe","name":"Axe","range_m":1.5,"damage":"1d6"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	rules, err := parseCreationRules(json.RawMessage(`{"classes":[{"id":"a","name":"A","defaults":{},"starting_equipment":{"attacks":["axe"]}}]}`), nil, compendium)
	if err != nil {
		t.Fatal(err)
	}
	if kit := rules.Classes[0].StartingEquipment; kit == nil || len(kit.Attacks) != 1 || kit.Attacks[0] != "axe" {
		t.Fatalf("unexpected starting equipment: %+v", kit)
	}
	if _, err := parseCreationRules(json.RawMessage(`{"classes":[{"id":"a","name":"A","defaults":{},"starting_equipment":{"attacks":["axe","axe"]}}]}`), nil, compendium); err == nil {
		t.Fatal("repeated starting equipment accepted")
	}
}

func TestCreationClassSpellListNamesCompendiumActions(t *testing.T) {
	compendium := game.Compendium{Actions: []game.Action{{ID: "bolt", Name: "Bolt"}}}
	for _, raw := range []string{
		`{"classes":[{"id":"a","name":"A","defaults":{},"spell_list":["bolt"]}]}`,
		`{"classes":[{"id":"a","name":"A","defaults":{},"spell_list":[]}]}`,
	} {
		if _, err := parseCreationRules(json.RawMessage(raw), nil, compendium); err != nil {
			t.Fatalf("valid spell list rejected: %s: %v", raw, err)
		}
	}
	for _, raw := range []string{
		`{"classes":[{"id":"a","name":"A","defaults":{},"spell_list":["fireball"]}]}`,
		`{"classes":[{"id":"a","name":"A","defaults":{},"spell_list":["bolt","bolt"]}]}`,
	} {
		if _, err := parseCreationRules(json.RawMessage(raw), nil, compendium); err == nil {
			t.Fatalf("invalid spell list accepted: %s", raw)
		}
	}
}
