package game

import "testing"

func TestRulesBlockingAndPassRules(t *testing.T) {
	wall := Structure{Geometry: []Point{{1, -1}, {1, 1}}, BlocksMovement: true, BlocksAttacks: true, PassRules: map[string]bool{}}
	tok := Token{}
	if CanMove([]Point{{0, 0}, {2, 0}}, []Structure{wall}, tok) {
		t.Fatal("movement should be blocked")
	}
	if CanTarget(Point{0, 0}, Point{2, 0}, []Structure{wall}, tok) {
		t.Fatal("attack should be blocked")
	}
	wall.PassRules = map[string]bool{"movement": true, "attacks": true}
	if !CanMove([]Point{{0, 0}, {2, 0}}, []Structure{wall}, tok) {
		t.Fatal("movement pass rule should override")
	}
	if !CanTarget(Point{0, 0}, Point{2, 0}, []Structure{wall}, tok) {
		t.Fatal("attack pass rule should override")
	}
	wall.IsHidden = true
	wall.PassRules = map[string]bool{}
	if !CanMove([]Point{{0, 0}, {2, 0}}, []Structure{wall}, tok) {
		t.Fatal("hidden structure should not block movement")
	}
	if !CanTarget(Point{0, 0}, Point{2, 0}, []Structure{wall}, tok) {
		t.Fatal("hidden structure should not block attacks")
	}
}
