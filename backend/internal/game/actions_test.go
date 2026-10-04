package game

import (
	"strings"
	"testing"
)

func TestResolveActionSaveDCAndDice(t *testing.T) {
	stats := map[string]any{"wisdom": 16.0, "proficiency_bonus": 2.0}
	r := ResolveAction(Action{Kind: ActionSave, Ability: "wisdom", Proficient: true, Bonus: 1, SaveAbility: "dexterity", Dice: "8d6", DiceBonus: 2}, stats)
	if r.SaveDC != 14 || r.ToHit != 0 || r.DiceModifier != 2 {
		t.Fatalf("save action should resolve to DC 14, dice +2: %+v", r)
	}
	heal := ResolveAction(Action{Kind: ActionHeal, Ability: "wisdom", Dice: "1d8", DiceBonus: 1, AbilityToDice: true}, stats)
	if heal.DiceModifier != 4 || heal.SaveDC != 0 || heal.ToHit != 0 {
		t.Fatalf("heal should add the ability modifier to dice only: %+v", heal)
	}
}

func TestParseActionsRejects(t *testing.T) {
	for name, tc := range map[string]struct{ json, want string }{
		"attack with area":     {`[{"id":"a","name":"Bolt","kind":"attack","range_m":10,"area_radius_m":2,"dice":"1d6"}]`, "cannot have an area"},
		"save without ability": {`[{"id":"a","name":"Burst","kind":"save","range_m":10,"dice":"1d6"}]`, "save ability must be one of"},
		"unknown damage type":  {`[{"id":"a","name":"Fruit","kind":"attack","range_m":1,"dice":"1d6","damage_type":"banana"}]`, "damage type must be one of"},
		"remaining above max":  {`[{"id":"a","name":"Cure","kind":"heal","range_m":1,"dice":"1d8","uses":{"max":1,"remaining":2}}]`, "uses must have"},
		"heal with damage":     {`[{"id":"a","name":"Cure","kind":"heal","range_m":1,"dice":"1d8","damage_type":"fire"}]`, "cannot have a damage type"},
		"duplicate id":         {`[{"id":"a","name":"A","kind":"heal","range_m":1,"dice":"1d8"},{"id":"a","name":"B","kind":"heal","range_m":1,"dice":"1d8"}]`, "unique id"},
	} {
		if _, err := ParseActions([]byte(tc.json)); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: want error containing %q, got %v", name, tc.want, err)
		}
	}
	got, err := ParseActions([]byte(`[{"id":"b","name":" Burst ","kind":"save","range_m":20,"area_radius_m":2,"save_ability":"dexterity","half_on_save":true,"dice":"2d6 + 1","damage_type":"fire","uses":{"max":1,"remaining":1}}]`))
	if err != nil || got[0].Name != "Burst" || got[0].Dice != "2d6+1" || got[0].Uses.Remaining != 1 {
		t.Fatalf("valid save action: %+v %v", got, err)
	}
}

func TestParseItemsRejects(t *testing.T) {
	if _, err := ParseItems([]byte(`[{"id":"p","name":"Potion","kind":"heal","range_m":1.5,"dice":"2d4","quantity":1,"uses":{"max":1,"remaining":1}}]`)); err == nil || !strings.Contains(err.Error(), "use quantity") {
		t.Fatalf("items cannot have uses: %v", err)
	}
	if _, err := ParseItems([]byte(`[{"id":"p","name":"Potion","kind":"heal","range_m":1.5,"dice":"2d4","quantity":0}]`)); err == nil || !strings.Contains(err.Error(), "quantity") {
		t.Fatalf("items need a quantity: %v", err)
	}
}

func TestStateReaders(t *testing.T) {
	stats := map[string]any{"hit_points": 0.0, "max_hit_points": 10.0, "death_save_failures": 2.0, "stable": true,
		"armor_class": 15.0, "resistances": []any{"fire", "banana", 3.0, "fire"}}
	if !IsDown(stats) || IsDead(stats) {
		t.Fatal("0 of 10 HP is down, not dead")
	}
	if IsDown(map[string]any{"hit_points": 0.0, "max_hit_points": 0.0}) {
		t.Fatal("no maximum means no tracked health")
	}
	if s := DeathSaveState(stats); s.Failures != 2 || s.Successes != 0 || !s.Stable || s.Dead {
		t.Fatalf("death saves: %+v", s)
	}
	d := DefenseState(stats)
	if *d.ArmorClass != 15 || len(d.Resistances) != 1 || d.Resistances[0] != "fire" || d.Immunities == nil {
		t.Fatalf("defenses: %+v", d)
	}
}
