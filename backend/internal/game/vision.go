package game

import (
	"math"
	"sort"
)

type VisibilityInput struct {
	IsDM       bool
	UserID     string
	MapWidthM  float64
	MapHeightM float64
	Tokens     []Token
	Structures []Structure
}
type VisibilityResult struct {
	FogPolygon          []Point  `json:"fogPolygon"`
	VisibleTokenIDs     []string `json:"visibleTokenIds"`
	VisibleStructureIDs []string `json:"visibleStructureIds"`
}

func ComputeVisibility(input VisibilityInput) VisibilityResult {
	if input.IsDM {
		r := VisibilityResult{FogPolygon: []Point{{0, 0}, {input.MapWidthM, 0}, {input.MapWidthM, input.MapHeightM}, {0, input.MapHeightM}}}
		for _, t := range input.Tokens {
			r.VisibleTokenIDs = append(r.VisibleTokenIDs, t.ID)
		}
		for _, s := range input.Structures {
			r.VisibleStructureIDs = append(r.VisibleStructureIDs, s.ID)
		}
		return r
	}
	var polys [][]Point
	visibleStruct := map[string]bool{}
	visibleTok := map[string]bool{}
	for _, t := range input.Tokens {
		if t.OwnerUserID == input.UserID && !t.IsHidden {
			poly := castFog(Point{t.X, t.Y}, t.RotationDeg, t.VisionAngleDeg, t.VisionRangeM, input.Structures)
			polys = append(polys, poly)
			visibleTok[t.ID] = true
			for _, s := range input.Structures {
				if structureVisible(Point{t.X, t.Y}, t, s) {
					visibleStruct[s.ID] = true
				}
			}
			for _, ot := range input.Tokens {
				if ot.IsHidden && ot.OwnerUserID != input.UserID {
					continue
				}
				if InCone(Point{t.X, t.Y}, t.RotationDeg, t.VisionAngleDeg, t.VisionRangeM, Point{ot.X, ot.Y}) {
					visibleTok[ot.ID] = true
				}
			}
		}
	}
	var fog []Point
	if len(polys) > 0 {
		fog = polys[0]
	}
	r := VisibilityResult{FogPolygon: fog}
	for id := range visibleTok {
		r.VisibleTokenIDs = append(r.VisibleTokenIDs, id)
	}
	for id := range visibleStruct {
		r.VisibleStructureIDs = append(r.VisibleStructureIDs, id)
	}
	sort.Strings(r.VisibleTokenIDs)
	sort.Strings(r.VisibleStructureIDs)
	return r
}

func structureVisible(origin Point, tok Token, st Structure) bool {
	if st.IsHidden {
		return false
	}
	for _, p := range st.Geometry {
		if InCone(origin, tok.RotationDeg, tok.VisionAngleDeg, tok.VisionRangeM, p) {
			return true
		}
	}
	return false
}

func castFog(origin Point, rot, angle, rng float64, structures []Structure) []Point {
	start := (rot - angle/2) * math.Pi / 180
	end := (rot + angle/2) * math.Pi / 180
	var angles []float64
	for a := start; a <= end+1e-9; a += 2 * math.Pi / 180 {
		angles = append(angles, a)
	}
	for _, st := range structures {
		if st.IsHidden || !st.BlocksVision {
			continue
		}
		for _, p := range st.Geometry {
			aa := math.Atan2(p.Y-origin.Y, p.X-origin.X)
			if betweenAngle(aa, start, end) {
				angles = append(angles, aa-0.0001, aa, aa+0.0001)
			}
		}
	}
	sort.Float64s(angles)
	poly := []Point{origin}
	for _, a := range angles {
		nearest := rng
		hit := Point{origin.X + math.Cos(a)*rng, origin.Y + math.Sin(a)*rng}
		for _, st := range structures {
			if st.IsHidden || !st.BlocksVision {
				continue
			}
			for _, seg := range structureSegments(st) {
				if p, ok, d := RaySegmentIntersection(origin, a, seg); ok && d < nearest {
					nearest = d
					hit = p
				}
			}
		}
		poly = append(poly, hit)
	}
	return poly
}

func betweenAngle(a, start, end float64) bool {
	for a < start {
		a += 2 * math.Pi
	}
	for a > end {
		a -= 2 * math.Pi
	}
	return a >= start-1e-9 && a <= end+1e-9
}
