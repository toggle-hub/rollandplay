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

func TestOpenDoorStopsBlocking(t *testing.T) {
	door := Structure{Kind: "door", Geometry: []Point{{1, -1}, {1, 1}}, BlocksMovement: true, BlocksAttacks: true, PassRules: map[string]bool{}}
	tok := Token{}
	path := []Point{{0, 0}, {2, 0}}
	if CanMove(path, []Structure{door}, tok) || CanTarget(path[0], path[1], []Structure{door}, tok) {
		t.Fatal("a closed door should block movement and attacks")
	}
	door.IsOpen = true
	if !CanMove(path, []Structure{door}, tok) || !CanTarget(path[0], path[1], []Structure{door}, tok) {
		t.Fatal("an open door should let movement and attacks through")
	}
	wall := door
	wall.Kind = "wall"
	if CanMove(path, []Structure{wall}, tok) {
		t.Fatal("only doors open; an open flag on a wall must not let tokens through")
	}
}
