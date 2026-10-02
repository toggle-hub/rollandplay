package game

import (
	"bytes"
	"testing"
)

func TestRollExpressionValid(t *testing.T) {
	rng := bytes.Repeat([]byte{0, 0, 0, 0, 0, 0, 0, 3}, 400)
	for _, expr := range []string{"1d20+5", "2d6-1", "d8+2"} {
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
	if _, err := RollExpression("alert(1)", bytes.NewReader(nil)); err == nil {
		t.Fatal("expected invalid expression error")
	}
}
func TestRollExpressionCaps(t *testing.T) {
	if _, err := RollExpression("101d6", bytes.NewReader(nil)); err == nil {
		t.Fatal("expected dice cap error")
	}
	if _, err := RollExpression("1d1001", bytes.NewReader(nil)); err == nil {
		t.Fatal("expected side cap error")
	}
}
