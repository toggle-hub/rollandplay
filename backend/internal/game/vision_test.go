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
	if !player.Fog || len(player.VisiblePolygons) != 1 || len(player.VisiblePolygons[0]) == 0 {
		t.Fatalf("expected one vision polygon under fog: %+v", player)
	}
	clipped, behind := false, false
	for _, p := range player.VisiblePolygons[0] {
		if p.X <= 5.01 && p.X >= 4.9 && p.Y >= -2 && p.Y <= 2 {
			clipped = true
		}
		if DistanceMeters(p, Point{-10, 0}) < 0.01 {
			behind = true
		}
	}
	if !clipped {
		t.Fatalf("expected wall clipping in vision polygon: %+v", player.VisiblePolygons[0])
	}
	if !behind {
		t.Fatalf("expected vision to reach behind the token: %+v", player.VisiblePolygons[0])
	}
	if !slices.Contains(player.VisibleTokenIDs, "near") || slices.Contains(player.VisibleTokenIDs, "far") {
		t.Fatalf("expected only tokens within the vision radius: %+v", player.VisibleTokenIDs)
	}
	dm := ComputeVisibility(VisibilityInput{IsDM: true, MapWidthM: 20, MapHeightM: 20, Tokens: []Token{tok}, Structures: []Structure{wall}})
	if dm.Fog || len(dm.VisiblePolygons) != 0 || len(dm.VisibleTokenIDs) != 1 || len(dm.VisibleStructureIDs) != 1 {
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
	for _, point := range player.VisiblePolygons[0] {
		if point.X > 4.9 && point.X < 5.01 && point.Y >= -2 && point.Y <= 2 {
			t.Fatalf("hidden structure should not clip vision: %+v", player.VisiblePolygons[0])
		}
	}

	dm := ComputeVisibility(VisibilityInput{IsDM: true, MapWidthM: 20, MapHeightM: 20, Tokens: []Token{token}, Structures: []Structure{wall}})
	if len(dm.VisibleStructureIDs) != 1 {
		t.Fatalf("DM should retain hidden structure visibility: %+v", dm.VisibleStructureIDs)
	}
}
