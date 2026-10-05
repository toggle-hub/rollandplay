package game

import (
	"errors"
	"slices"
	"strings"
	"testing"
)

func TestNormalizeConditions(t *testing.T) {
	got, err := NormalizeConditions([]string{" Prone ", "prone", "", "Hexed  by   the witch", "hexed by the WITCH", "CONCENTRATING"})
	if err != nil || !slices.Equal(got, []string{"prone", "Hexed by the witch", "concentrating"}) {
		t.Fatalf("known conditions are keyed, custom ones kept as typed, duplicates and blanks dropped: %q %v", got, err)
	}
	if got, err := NormalizeConditions(nil); err != nil || got == nil || len(got) != 0 {
		t.Fatalf("no conditions is an empty list: %q %v", got, err)
	}
	if _, err := NormalizeConditions([]string{strings.Repeat("x", MaxConditionLength+1)}); err == nil {
		t.Fatal("an overlong condition should be rejected")
	}
	many := make([]string, MaxConditions+1)
	for i := range many {
		many[i] = strings.Repeat("a", i+1)
	}
	if _, err := NormalizeConditions(many); err == nil {
		t.Fatal("too many conditions should be rejected")
	}
}

func TestHealthStatus(t *testing.T) {
	for _, tc := range []struct {
		stats map[string]any
		want  string
	}{
		{map[string]any{"hit_points": 3.0, "max_hit_points": 10.0}, ""},
		{map[string]any{"hit_points": 0.0}, ""}, // no maximum: not tracked
		{map[string]any{"hit_points": 0.0, "max_hit_points": 10.0}, StatusDown},
		{map[string]any{"hit_points": 0.0, "max_hit_points": 10.0, "stable": true}, StatusStable},
		{map[string]any{"hit_points": 0.0, "max_hit_points": 10.0, "dead": true}, StatusDead},
	} {
		if got := HealthStatus(tc.stats); got != tc.want {
			t.Fatalf("%v: want %q, got %q", tc.stats, tc.want, got)
		}
	}
}

func TestTokenSides(t *testing.T) {
	gms := []string{"gm"}
	hero := Token{OwnerUserID: "alice", SheetID: "s", SheetOwnerUserID: "alice"}
	placedForBob := Token{OwnerUserID: "gm", SheetID: "s2", SheetOwnerUserID: "bob"}
	goblin := Token{OwnerUserID: "gm"}
	for _, tc := range []struct {
		token  Token
		viewer string
		want   string
	}{
		{hero, "alice", SideOwn},
		{hero, "bob", SideParty},
		{hero, "gm", SideParty},
		{placedForBob, "bob", SideOwn},
		{placedForBob, "alice", SideParty},
		{goblin, "gm", SideNPC},
		{goblin, "alice", SideNPC},
	} {
		if got := tc.token.SideFor(tc.viewer, gms); got != tc.want {
			t.Fatalf("%+v seen by %s: want %s, got %s", tc.token, tc.viewer, tc.want, got)
		}
	}
}

func TestAdjustHealth(t *testing.T) {
	patch, err := AdjustHealth(target(map[string]any{"hit_points": 10.0, "max_hit_points": 12.0, "temporary_hit_points": 3.0}, false), 5, 0)
	if err != nil || patch["temporary_hit_points"] != 0 || patch["hit_points"] != 8 {
		t.Fatalf("damage should spend temporary HP first: %+v %v", patch, err)
	}
	if patch, _ := AdjustHealth(target(map[string]any{"hit_points": 10.0, "max_hit_points": 12.0}, false), 0, 7); patch["hit_points"] != 12 {
		t.Fatalf("healing should stop at the maximum: %+v", patch)
	}
	if patch, _ := AdjustHealth(target(map[string]any{"hit_points": 0.0, "max_hit_points": 12.0}, true), 2, 0); patch["death_save_failures"] != 1 {
		t.Fatalf("damage at 0 HP should fail a death save: %+v", patch)
	}
	if _, err := AdjustHealth(target(map[string]any{}, false), 4, 0); !errors.Is(err, ErrNoHealth) {
		t.Fatalf("a token without HP can't be damaged: %v", err)
	}
	if _, err := AdjustHealth(target(map[string]any{"hit_points": 0.0, "max_hit_points": 12.0, "dead": true}, true), 0, 4); !errors.Is(err, ErrDeadTarget) {
		t.Fatalf("the dead can't be healed: %v", err)
	}
}

func TestLongRest(t *testing.T) {
	stats := map[string]any{
		"hit_points": 0.0, "max_hit_points": 20.0, "temporary_hit_points": 4.0,
		"death_save_successes": 2.0, "death_save_failures": 1.0, "stable": true,
		"actions": []any{
			map[string]any{"id": "bless", "name": "Bless", "kind": "heal", "range_m": 9.0, "dice": "1d4", "uses": map[string]any{"max": 3.0, "remaining": 0.0}},
			map[string]any{"id": "shove", "name": "Shove", "kind": "attack", "range_m": 1.5, "dice": "1d4"},
		},
	}
	patch := LongRest(target(stats, true))
	if patch["hit_points"] != 20 || patch["temporary_hit_points"] != 0 || patch["death_save_successes"] != 0 || patch["death_save_failures"] != 0 || patch["stable"] != false {
		t.Fatalf("a long rest should restore health and clear death saves: %+v", patch)
	}
	actions, ok := patch["actions"].([]Action)
	if !ok || len(actions) != 2 || actions[0].Uses == nil || actions[0].Uses.Remaining != 3 || actions[1].Uses != nil {
		t.Fatalf("a long rest should refill limited uses only: %+v", patch["actions"])
	}
	if patch := LongRest(target(map[string]any{"hit_points": 20.0, "max_hit_points": 20.0}, true)); len(patch) != 0 {
		t.Fatalf("a rested character should not change: %+v", patch)
	}
	if patch := LongRest(target(map[string]any{"hit_points": 0.0, "max_hit_points": 20.0, "dead": true}, true)); len(patch) != 0 {
		t.Fatalf("the dead do not rest: %+v", patch)
	}
}
