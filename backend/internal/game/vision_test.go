package game

import "testing"

func TestVisionWallClipsAndDMSeesAll(t *testing.T) {
	wall := Structure{ID: "wall", Geometry: []Point{{5, -2}, {5, 2}}, BlocksVision: true}
	tok := Token{ID: "t1", OwnerUserID: "u1", X: 0, Y: 0, RotationDeg: 0, VisionAngleDeg: 90, VisionRangeM: 10}
	player := ComputeVisibility(VisibilityInput{UserID: "u1", MapWidthM: 20, MapHeightM: 20, Tokens: []Token{tok}, Structures: []Structure{wall}})
	if len(player.FogPolygon) == 0 {
		t.Fatal("expected fog polygon")
	}
	clipped := false
	for _, p := range player.FogPolygon {
		if p.X <= 5.01 && p.X >= 4.9 {
			clipped = true
		}
	}
	if !clipped {
		t.Fatalf("expected wall clipping in fog polygon: %+v", player.FogPolygon)
	}
	dm := ComputeVisibility(VisibilityInput{IsDM: true, MapWidthM: 20, MapHeightM: 20, Tokens: []Token{tok}, Structures: []Structure{wall}})
	if len(dm.FogPolygon) != 4 || len(dm.VisibleTokenIDs) != 1 || len(dm.VisibleStructureIDs) != 1 {
		t.Fatalf("DM should see full map: %+v", dm)
	}
}

func TestHiddenStructureDoesNotBlockOrRevealToPlayers(t *testing.T) {
	wall := Structure{ID: "wall", Geometry: []Point{{5, -2}, {5, 2}}, BlocksVision: true, IsHidden: true}
	token := Token{ID: "token", OwnerUserID: "player", X: 0, Y: 0, RotationDeg: 0, VisionAngleDeg: 90, VisionRangeM: 10}

	player := ComputeVisibility(VisibilityInput{UserID: "player", MapWidthM: 20, MapHeightM: 20, Tokens: []Token{token}, Structures: []Structure{wall}})

	if len(player.VisibleStructureIDs) != 0 {
		t.Fatalf("hidden structure should not be visible: %+v", player.VisibleStructureIDs)
	}
	for _, point := range player.FogPolygon {
		if point.X > 4.9 && point.X < 5.01 {
			t.Fatalf("hidden structure should not clip vision: %+v", player.FogPolygon)
		}
	}

	dm := ComputeVisibility(VisibilityInput{IsDM: true, MapWidthM: 20, MapHeightM: 20, Tokens: []Token{token}, Structures: []Structure{wall}})
	if len(dm.VisibleStructureIDs) != 1 {
		t.Fatalf("DM should retain hidden structure visibility: %+v", dm.VisibleStructureIDs)
	}
}
