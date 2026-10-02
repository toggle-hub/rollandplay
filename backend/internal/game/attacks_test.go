package game

import (
	"fmt"
	"strings"
	"testing"
)

func TestResolveAttackAddsAbilityAndProficiency(t *testing.T) {
	stats := map[string]any{"strength": float64(16), "proficiency_bonus": float64(2)}
	r := ResolveAttack(Attack{Ability: "strength", Proficient: true, AttackBonus: 1, Damage: "1d8"}, stats)
	if r.ToHit != 6 || r.AttackExpression() != "1d20+6" || r.DamageExpression() != "1d8+3" {
		t.Fatalf("resolved %+v: %s / %s", r, r.AttackExpression(), r.DamageExpression())
	}
}

func TestResolveAttackFloorsNegativeModifier(t *testing.T) {
	r := ResolveAttack(Attack{Ability: "strength", Damage: "1d6"}, map[string]any{"strength": float64(9)})
	if r.AttackExpression() != "1d20-1" || r.DamageExpression() != "1d6-1" {
		t.Fatalf("got %s / %s", r.AttackExpression(), r.DamageExpression())
	}
}

func TestResolveAttackMissingStatsCountAsZero(t *testing.T) {
	stats := map[string]any{"strength": "strong", "proficiency_bonus": "two"}
	r := ResolveAttack(Attack{Ability: "dexterity", Proficient: true, Damage: "1d8"}, stats)
	if r.AttackExpression() != "1d20" || r.DamageExpression() != "1d8" {
		t.Fatalf("got %s / %s", r.AttackExpression(), r.DamageExpression())
	}
	r = ResolveAttack(Attack{Ability: "strength", Damage: "1d8"}, stats)
	if r.ToHit != 0 || r.DamageModifier != 0 {
		t.Fatalf("non-numeric ability should count as 0: %+v", r)
	}
}

func TestParseAttacks(t *testing.T) {
	valid := `{"id":"a","name":" Sword ","range_m":1.5,"ability":"strength","proficient":true,"attack_bonus":0,"damage":" 1d8 + 2 ","damage_bonus":0}`
	attacks, err := ParseAttacks([]byte("[" + valid + "]"))
	if err != nil || len(attacks) != 1 || attacks[0].Name != "Sword" || attacks[0].Damage != "1d8+2" {
		t.Fatalf("valid attack: %+v %v", attacks, err)
	}
	for _, raw := range []string{"null", "", "  "} {
		if attacks, err := ParseAttacks([]byte(raw)); err != nil || attacks == nil || len(attacks) != 0 {
			t.Fatalf("%q should parse as empty: %+v %v", raw, attacks, err)
		}
	}
	many := make([]string, MaxAttacks+1)
	for i := range many {
		many[i] = fmt.Sprintf(`{"id":"a%d","name":"A","range_m":1,"damage":"1d4"}`, i)
	}
	for name, tc := range map[string]struct{ raw, err string }{
		"unknown field": {`[{"id":"a","name":"A","range_m":1,"damage":"1d4","to_hit":5}]`, "attacks must be a list of attack objects"},
		"bad damage":    {`[{"id":"a","name":"A","range_m":1,"damage":"banana"}]`, `attack "A" damage must be a dice expression such as 1d8+2`},
		"dice cap":      {`[{"id":"a","name":"A","range_m":1,"damage":"1000d6"}]`, `attack "A" damage must be a dice expression such as 1d8+2`},
		"duplicate id":  {`[{"id":"a","name":"A","range_m":1,"damage":"1d4"},{"id":"a","name":"B","range_m":1,"damage":"1d4"}]`, "attack 2 needs a unique id"},
		"zero range":    {`[{"id":"a","name":"A","range_m":0,"damage":"1d4"}]`, `attack "A" range must be between 0 and 1000 meters`},
		"blank name":    {`[{"id":"a","name":"  ","range_m":1,"damage":"1d4"}]`, "attack 1 needs a name of at most 80 characters"},
		"bonus":         {`[{"id":"a","name":"A","range_m":1,"damage":"1d4","damage_bonus":101}]`, `attack "A" bonuses must be between -100 and 100`},
		"too many":      {"[" + strings.Join(many, ",") + "]", "a character can have at most 20 attacks"},
	} {
		if _, err := ParseAttacks([]byte(tc.raw)); err == nil || err.Error() != tc.err {
			t.Errorf("%s: got %v, want %q", name, err, tc.err)
		}
	}
}

func TestInAttackRangeIsInclusive(t *testing.T) {
	from, to := Point{X: 1, Y: 1}, Point{X: 4, Y: 5}
	if !InAttackRange(from, to, 5) {
		t.Fatal("target exactly at range should be in range")
	}
	if InAttackRange(from, Point{X: 1, Y: 6.01}, 5) {
		t.Fatal("target past range should be out of range")
	}
}

func TestTokenAttackListReadsStats(t *testing.T) {
	tok := Token{Stats: map[string]any{"attacks": []any{map[string]any{"id": "a", "name": "Bite", "range_m": 1.0, "damage": "1d6"}}}}
	attacks, err := tok.AttackList()
	if err != nil || len(attacks) != 1 || attacks[0].Name != "Bite" {
		t.Fatalf("got %+v %v", attacks, err)
	}
	if attacks, err := (Token{}).AttackList(); err != nil || len(attacks) != 0 {
		t.Fatalf("no stats: %+v %v", attacks, err)
	}
}
