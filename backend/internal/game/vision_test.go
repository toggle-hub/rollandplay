package game

import (
	"slices"
	"testing"
)

func TestVisionWallClipsAndDMSeesAll(t *testing.T) {
	wall := Structure{ID: "wall", Geometry: []Point{{5, -2}, {5, 2}}, BlocksVision: true}
	tok := Token{ID: "t1", OwnerUserID: "u1", X: 0, Y: 0, VisionRangeM: 10}
	near := Token{ID: "near", OwnerUserID: "u2", X: -3, Y: 0, VisionRangeM: 10}
	far := Token{ID: "far", OwnerUserID: "u2", X: 11, Y: 0, VisionRangeM: 10}
	player := ComputeVisibility(VisibilityInput{UserID: "u1", MapWidthM: 20, MapHeightM: 20, Tokens: []Token{tok, near, far}, Structures: []Structure{wall}})
	if !player.Fog || len(player.VisionAreas) != 1 || len(player.VisionAreas[0].Polygon) == 0 {
		t.Fatalf("expected one vision polygon under fog: %+v", player)
	}
	if area := player.VisionAreas[0]; area.TokenID != "t1" || area.Origin != (Point{0, 0}) {
		t.Fatalf("expected the area to name its token and origin: %+v", area)
	}
	clipped, behind := false, false
	for _, p := range player.VisionAreas[0].Polygon {
		if p.X <= 5.01 && p.X >= 4.9 && p.Y >= -2 && p.Y <= 2 {
			clipped = true
		}
		if DistanceMeters(p, Point{-10, 0}) < 0.01 {
			behind = true
		}
	}
	if !clipped {
		t.Fatalf("expected wall clipping in vision polygon: %+v", player.VisionAreas[0].Polygon)
	}
	if !behind {
		t.Fatalf("expected vision to reach behind the token: %+v", player.VisionAreas[0].Polygon)
	}
	if !slices.Contains(player.VisibleTokenIDs, "near") || slices.Contains(player.VisibleTokenIDs, "far") {
		t.Fatalf("expected only tokens within the vision radius: %+v", player.VisibleTokenIDs)
	}
	dm := ComputeVisibility(VisibilityInput{IsDM: true, MapWidthM: 20, MapHeightM: 20, Tokens: []Token{tok}, Structures: []Structure{wall}})
	if dm.Fog || len(dm.VisionAreas) != 0 || len(dm.VisibleTokenIDs) != 1 || len(dm.VisibleStructureIDs) != 1 {
		t.Fatalf("DM should see full map: %+v", dm)
	}
}

func TestHiddenStructureDoesNotBlockOrRevealToPlayers(t *testing.T) {
	wall := Structure{ID: "wall", Geometry: []Point{{5, -2}, {5, 2}}, BlocksVision: true, IsHidden: true}
	token := Token{ID: "token", OwnerUserID: "player", X: 0, Y: 0, VisionRangeM: 10}

	player := ComputeVisibility(VisibilityInput{UserID: "player", MapWidthM: 20, MapHeightM: 20, Tokens: []Token{token}, Structures: []Structure{wall}})

	if len(player.VisibleStructureIDs) != 0 {
		t.Fatalf("hidden structure should not be visible: %+v", player.VisibleStructureIDs)
	}
	for _, point := range player.VisionAreas[0].Polygon {
		if point.X > 4.9 && point.X < 5.01 && point.Y >= -2 && point.Y <= 2 {
			t.Fatalf("hidden structure should not clip vision: %+v", player.VisionAreas[0].Polygon)
		}
	}

	dm := ComputeVisibility(VisibilityInput{IsDM: true, MapWidthM: 20, MapHeightM: 20, Tokens: []Token{token}, Structures: []Structure{wall}})
	if len(dm.VisibleStructureIDs) != 1 {
		t.Fatalf("DM should retain hidden structure visibility: %+v", dm.VisibleStructureIDs)
	}
}

func TestTokenVisibleTo(t *testing.T) {
	mine := Token{ID: "mine", OwnerUserID: "p", X: 0, Y: 0, VisionRangeM: 5}
	for _, tc := range []struct {
		name   string
		userID string
		target Token
		want   bool
	}{
		{"in vision range", "p", Token{ID: "goblin", X: 3, Y: 0}, true},
		{"out of vision range", "p", Token{ID: "goblin", X: 6, Y: 0}, false},
		{"hidden in range", "p", Token{ID: "goblin", X: 1, Y: 0, IsHidden: true}, false},
		{"movable far away", "p", Token{ID: "ally", OwnerUserID: "q", MoverUserIDs: []string{"p"}, X: 50, Y: 50}, true},
		{"own hidden far away", "p", Token{ID: "own", OwnerUserID: "p", X: 50, Y: 50, IsHidden: true}, true},
		{"no user against ownerless", "", Token{ID: "goblin", X: 1, Y: 0}, false},
	} {
		if got := TokenVisibleTo(tc.userID, tc.target, []Token{mine, tc.target}); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestOpenDoorLetsVisionThroughAndStaysVisible(t *testing.T) {
	door := Structure{ID: "door", Kind: "door", Geometry: []Point{{5, -2}, {5, 2}}, BlocksVision: true}
	token := Token{ID: "token", OwnerUserID: "player", X: 0, Y: 0, VisionRangeM: 10}
	seesPast := func(door Structure) bool {
		vis := ComputeVisibility(VisibilityInput{UserID: "player", MapWidthM: 20, MapHeightM: 20, Tokens: []Token{token}, Structures: []Structure{door}})
		if len(vis.VisibleStructureIDs) != 1 {
			t.Fatalf("the door itself should stay visible: %+v", vis.VisibleStructureIDs)
		}
		for _, point := range vis.VisionAreas[0].Polygon {
			if point.X > 6 && point.Y > -1 && point.Y < 1 {
				return true
			}
		}
		return false
	}
	if seesPast(door) {
		t.Fatal("a closed door should block sight")
	}
	door.IsOpen = true
	if !seesPast(door) {
		t.Fatal("an open door should let sight through")
	}
}
