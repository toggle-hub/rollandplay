package game

import (
	"bytes"
	"slices"
	"testing"
)

func TestRollExpressionValid(t *testing.T) {
	rng := bytes.Repeat([]byte{0, 0, 0, 0, 0, 0, 0, 3}, 400)
	for _, expr := range []string{"1d20+5", "2d6-1", "d8+2", "2d20kh1+5", "2d20kl1", "4d6kh3", "1d8+2d20kl1-1"} {
		res, err := RollExpression(expr, bytes.NewReader(rng))
		if err != nil {
			t.Fatalf("%s: %v", expr, err)
		}
		if res.Total == 0 || len(res.Dice) == 0 {
			t.Fatalf("%s produced empty roll: %+v", expr, res)
		}
	}
}
func TestRollExpressionRejectsInvalid(t *testing.T) {
	for _, expr := range []string{"alert(1)", "2d20k1", "2d20kh", "kh1", "2d20kx1", "2d20kh1kl1", "5kh1"} {
		if _, err := RollExpression(expr, bytes.NewReader(nil)); err == nil {
			t.Errorf("%s: expected invalid expression error", expr)
		}
	}
}
func TestRollExpressionCaps(t *testing.T) {
	for _, expr := range []string{"101d6", "1d1001", "101d20kh1", "2d20kh3", "2d20kl0", "d20kh2"} {
		if _, err := RollExpression(expr, bytes.NewReader(nil)); err == nil {
			t.Errorf("%s: expected a cap error", expr)
		}
	}
}

func TestRollExpressionKeepsHighestOrLowest(t *testing.T) {
	tests := []struct {
		name  string
		expr  string
		rolls []uint64 // each rolls v % sides + 1
		total int
		kept  []bool
	}{
		{"advantage keeps the higher d20", "2d20kh1+3", []uint64{3, 16}, 20, []bool{false, true}},
		{"disadvantage keeps the lower d20", "2d20kl1+3", []uint64{3, 16}, 7, []bool{true, false}},
		{"a tie keeps the earlier die", "2d20kh1", []uint64{9, 9}, 10, []bool{true, false}},
		{"4d6kh3 drops the lowest", "4d6kh3", []uint64{0, 5, 2, 3}, 6 + 3 + 4, []bool{false, true, true, true}},
		{"keeping every die keeps them all", "3d4kl3", []uint64{0, 1, 2}, 6, []bool{true, true, true}},
		{"a subtracted keep term subtracts only kept dice", "10-2d6kh1", []uint64{1, 4}, 5, []bool{false, true}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := RollExpression(tt.expr, dice(tt.rolls...))
			if err != nil {
				t.Fatal(err)
			}
			die := res.Dice[len(res.Dice)-1]
			if res.Total != tt.total || !slices.Equal(die.Kept, tt.kept) || die.Keep == "" || len(die.Values) != len(tt.rolls) {
				t.Fatalf("got total %d, die %+v; want total %d, kept %v", res.Total, die, tt.total, tt.kept)
			}
		})
	}
	plain, _ := RollExpression("2d6", dice(1, 2))
	if plain.Dice[0].Kept != nil || plain.Dice[0].Keep != "" || plain.Total != 5 {
		t.Fatalf("a plain term keeps every die without marking them: %+v", plain)
	}
}

func TestRollNaturalIsTheKeptDie(t *testing.T) {
	adv, _ := RollExpression("2d20kh1+1", dice(0, 19))
	dis, _ := RollExpression("2d20kl1+1", dice(19, 0))
	plain, _ := RollExpression("1d20+1", dice(12))
	if adv.Natural() != 20 || dis.Natural() != 1 || plain.Natural() != 13 {
		t.Fatalf("natural: advantage %d, disadvantage %d, plain %d", adv.Natural(), dis.Natural(), plain.Natural())
	}
	if flat, _ := RollExpression("5", nil); flat.Natural() != 0 {
		t.Fatalf("a roll without dice has no natural die: %d", flat.Natural())
	}
}

func TestRollOptions(t *testing.T) {
	tests := []struct {
		opts RollOptions
		mod  int
		expr string
		note string
	}{
		{RollOptions{}, 3, "1d20+3", ""},
		{RollOptions{Mode: RollNormal}, 0, "1d20", ""},
		{RollOptions{Mode: RollAdvantage}, 3, "2d20kh1+3", "advantage"},
		{RollOptions{Mode: RollDisadvantage, Bonus: -1}, 3, "2d20kl1+2", "disadvantage, -1 bonus"},
		{RollOptions{Bonus: 2}, -2, "1d20", "+2 bonus"},
	}
	for _, tt := range tests {
		if got := tt.opts.D20(tt.mod); got != tt.expr {
			t.Errorf("%+v D20(%d) = %q, want %q", tt.opts, tt.mod, got, tt.expr)
		}
		if got := tt.opts.Note(); got != tt.note {
			t.Errorf("%+v note = %q, want %q", tt.opts, got, tt.note)
		}
		if err := tt.opts.Validate(); err != nil {
			t.Errorf("%+v: %v", tt.opts, err)
		}
	}
	for _, bad := range []RollOptions{{Mode: "lucky"}, {Bonus: MaxRollBonus + 1}, {Bonus: -MaxRollBonus - 1}} {
		if bad.Validate() == nil {
			t.Errorf("%+v: expected a validation error", bad)
		}
	}
}
