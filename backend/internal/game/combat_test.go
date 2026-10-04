package game

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

// dice feeds rollOne: each value v rolls v % sides + 1, so 19 is a natural 20 on a d20.
func dice(values ...uint64) io.Reader {
	b := make([]byte, 8*len(values))
	for i, v := range values {
		binary.BigEndian.PutUint64(b[8*i:], v)
	}
	return bytes.NewReader(b)
}

func target(stats map[string]any, sheet bool) Target {
	return Target{TokenID: "t", Name: "Goblin", Stats: stats, SheetBacked: sheet}
}

var sword = ResolvedAction{Action: Action{Kind: ActionAttack, Dice: "1d8"}, ToHit: 2, DiceModifier: 3}

func TestRollAttack(t *testing.T) {
	out, dmg, patch, err := RollAttack(sword, target(map[string]any{"armor_class": 30.0, "hit_points": 20.0}, false), dice(19, 4, 4))
	if err != nil || out.Result != ResultCritical || dmg.Expression != "2d8+3" || dmg.Total != 13 || out.Damage != 13 || patch["hit_points"] != 7 {
		t.Fatalf("natural 20 should crit through any armor: %+v %+v %+v %v", out, dmg, patch, err)
	}
	out, dmg, patch, _ = RollAttack(sword, target(map[string]any{"armor_class": 1.0, "hit_points": 20.0}, false), dice(0))
	if out.Result != ResultMiss || dmg != nil || patch != nil {
		t.Fatalf("natural 1 should always miss: %+v %+v %+v", out, dmg, patch)
	}
	out, _, patch, _ = RollAttack(sword, target(map[string]any{"armor_class": 12.0, "hit_points": 20.0}, false), dice(9, 0))
	if out.Result != ResultHit || out.Roll.Total != 12 || patch["hit_points"] != 16 {
		t.Fatalf("a total equal to armor class should hit: %+v %+v", out, patch)
	}
	if out, _, _, _ := RollAttack(sword, target(map[string]any{}, false), dice(6)); out.Result != ResultMiss {
		t.Fatalf("missing armor class counts as 10, so 7+2 misses: %+v", out)
	}
	if out, _, _, _ := RollAttack(sword, target(map[string]any{}, false), dice(7, 0)); out.Result != ResultHit {
		t.Fatalf("missing armor class counts as 10, so 8+2 hits: %+v", out)
	}
}

func TestApplyDamage(t *testing.T) {
	out, patch := applyDamage(target(map[string]any{"hit_points": 20.0, "temporary_hit_points": 5.0}, false), 8, false)
	if patch["temporary_hit_points"] != 0 || patch["hit_points"] != 17 || out.Damage != 8 || out.Down {
		t.Fatalf("temporary HP should absorb first: %+v %+v", out, patch)
	}
	out, patch = applyDamage(target(map[string]any{"hit_points": 5.0, "max_hit_points": 10.0}, true), 9, false)
	if patch["hit_points"] != 0 || !out.Down || patch["death_save_failures"] != nil {
		t.Fatalf("HP should clamp at 0 and drop the target: %+v %+v", out, patch)
	}
	if _, patch := applyDamage(target(map[string]any{"hit_points": 3.0}, false), 0, false); patch != nil {
		t.Fatalf("no damage should not patch: %+v", patch)
	}
	down := map[string]any{"hit_points": 0.0, "max_hit_points": 10.0}
	if _, patch := applyDamage(target(down, true), 4, false); patch["death_save_failures"] != 1 || patch["dead"] != nil {
		t.Fatalf("damage while down is one failure: %+v", patch)
	}
	if _, patch := applyDamage(target(down, true), 4, true); patch["death_save_failures"] != 2 {
		t.Fatalf("a critical hit while down is two failures: %+v", patch)
	}
	down["death_save_failures"] = 2.0
	if out, patch := applyDamage(target(down, true), 1, false); patch["dead"] != true || !out.Dead {
		t.Fatalf("a third failure kills: %+v %+v", out, patch)
	}
	if _, patch := applyDamage(target(map[string]any{"hit_points": 0.0}, false), 4, false); patch["death_save_failures"] != nil {
		t.Fatalf("monsters make no death saves: %+v", patch)
	}
}

func TestAdjustForDefenses(t *testing.T) {
	stats := map[string]any{"resistances": []any{"fire"}, "immunities": []any{"poison"}, "vulnerabilities": []any{"cold", "fire"}}
	for _, tc := range []struct {
		damageType, label string
		amount, want      int
	}{{"", "", 7, 7}, {"slashing", "", 7, 7}, {"poison", "immune", 7, 0}, {"cold", "vulnerable", 7, 14}, {"fire", "", 7, 6}} {
		if got, label := adjustForDefenses(stats, tc.damageType, tc.amount); got != tc.want || label != tc.label {
			t.Errorf("%q: got %d %q, want %d %q", tc.damageType, got, label, tc.want, tc.label)
		}
	}
	if got, label := adjustForDefenses(map[string]any{"resistances": []any{"fire"}}, "fire", 7); got != 3 || label != "resistant" {
		t.Fatalf("resistance halves rounding down: %d %q", got, label)
	}
}

func TestResolveSave(t *testing.T) {
	burst := ResolvedAction{Action: Action{Kind: ActionSave, SaveAbility: "dexterity", HalfOnSave: true}, SaveDC: 10}
	stats := map[string]any{"dexterity": 10.0, "hit_points": 20.0}
	out, patch, err := ResolveSave(burst, 9, target(stats, false), dice(14))
	if err != nil || out.Result != ResultSaved || out.Damage != 4 || patch["hit_points"] != 16 || out.Roll.Expression != "1d20" {
		t.Fatalf("a save should halve: %+v %+v %v", out, patch, err)
	}
	burst.HalfOnSave = false
	if out, patch, _ := ResolveSave(burst, 9, target(stats, false), dice(14)); out.Damage != 0 || patch != nil {
		t.Fatalf("a save without half on save takes nothing: %+v %+v", out, patch)
	}
	if out, patch, _ := ResolveSave(burst, 9, target(stats, false), dice(3)); out.Result != ResultFailed || out.Damage != 9 || patch["hit_points"] != 11 {
		t.Fatalf("a failed save takes it all: %+v %+v", out, patch)
	}
}

func TestApplyHealing(t *testing.T) {
	out, patch := ApplyHealing(5, target(map[string]any{"hit_points": 8.0, "max_hit_points": 10.0}, false))
	if out.Result != ResultHealed || out.Healing != 2 || patch["hit_points"] != 10 {
		t.Fatalf("healing caps at max: %+v %+v", out, patch)
	}
	_, patch = ApplyHealing(3, target(map[string]any{"hit_points": 0.0, "max_hit_points": 10.0, "death_save_failures": 2.0, "stable": true}, true))
	if patch["hit_points"] != 3 || patch["death_save_failures"] != 0 || patch["death_save_successes"] != 0 || patch["stable"] != false {
		t.Fatalf("healing a dying character clears death saves: %+v", patch)
	}
	if out, patch := ApplyHealing(3, target(map[string]any{"hit_points": 0.0, "dead": true}, true)); out.Result != ResultNoEffect || patch != nil {
		t.Fatalf("the dead cannot be healed: %+v %+v", out, patch)
	}
}

func TestDeathSave(t *testing.T) {
	dying := func(extra map[string]any) Target {
		stats := map[string]any{"hit_points": 0.0, "max_hit_points": 10.0}
		for k, v := range extra {
			stats[k] = v
		}
		return target(stats, true)
	}
	if out, patch, _ := DeathSave(dying(nil), dice(19)); out.Result != ResultRevived || patch["hit_points"] != 1 {
		t.Fatalf("a 20 revives: %+v %+v", out, patch)
	}
	if out, patch, _ := DeathSave(dying(map[string]any{"death_save_successes": 2.0}), dice(9)); out.Result != ResultStable || patch["stable"] != true || patch["death_save_successes"] != 0 {
		t.Fatalf("a third success stabilizes: %+v %+v", out, patch)
	}
	if out, patch, _ := DeathSave(dying(nil), dice(9)); out.Result != ResultSuccess || patch["death_save_successes"] != 1 {
		t.Fatalf("10 succeeds: %+v %+v", out, patch)
	}
	if out, patch, _ := DeathSave(dying(nil), dice(8)); out.Result != ResultFailure || patch["death_save_failures"] != 1 {
		t.Fatalf("9 fails: %+v %+v", out, patch)
	}
	if out, patch, _ := DeathSave(dying(map[string]any{"death_save_failures": 2.0}), dice(0)); out.Result != ResultDead || !out.Dead || patch["dead"] != true || patch["death_save_failures"] != 4 {
		t.Fatalf("a 1 at two failures kills: %+v %+v", out, patch)
	}
}

func TestDoubleDice(t *testing.T) {
	for in, want := range map[string]string{"d6+1d4": "2d6+2d4", "60d6": "100d6", "1d8+3": "2d8+3", "-1d4+2": "-2d4+2"} {
		if got := DoubleDice(in); got != want {
			t.Errorf("DoubleDice(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestConsume(t *testing.T) {
	stats := map[string]any{
		"actions": []any{map[string]any{"id": "burst", "name": "Burst", "kind": "heal", "range_m": 1.0, "dice": "1d4", "uses": map[string]any{"max": 2.0, "remaining": 1.0}},
			map[string]any{"id": "cure", "name": "Cure", "kind": "heal", "range_m": 1.0, "dice": "1d4"}},
		"items": []any{map[string]any{"id": "potion", "name": "Potion", "kind": "heal", "range_m": 1.5, "dice": "2d4", "quantity": 1.0}},
	}
	list, left, err := ConsumeUse(stats, "burst")
	if err != nil || *left != 0 || list[0].Uses.Remaining != 0 {
		t.Fatalf("one use spent: %+v %v %v", list, left, err)
	}
	if list, left, err := ConsumeUse(stats, "cure"); err != nil || left != nil || len(list) != 2 {
		t.Fatalf("unlimited actions are free: %v %v", left, err)
	}
	stats["actions"] = list
	if _, _, err := ConsumeUse(stats, "burst"); !errors.Is(err, ErrNoUses) {
		t.Fatalf("no uses left: %v", err)
	}
	if _, _, err := ConsumeUse(stats, "axe"); !errors.Is(err, ErrUnknownAction) {
		t.Fatalf("unknown action: %v", err)
	}
	items, qty, err := ConsumeItem(stats, "potion")
	if err != nil || qty != 0 || len(items) != 0 {
		t.Fatalf("the last potion is used up: %+v %d %v", items, qty, err)
	}
}
