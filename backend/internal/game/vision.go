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
	Fog                 bool         `json:"fog"`
	VisionAreas         []VisionArea `json:"visionAreas"`
	VisibleTokenIDs     []string     `json:"visibleTokenIds"`
	VisibleStructureIDs []string     `json:"visibleStructureIds"`
}

// VisionArea is what one of the viewer's tokens sees from Origin, its position when cast.
type VisionArea struct {
	TokenID string  `json:"tokenId"`
	Origin  Point   `json:"origin"`
	Polygon []Point `json:"polygon"`
}

func ComputeVisibility(input VisibilityInput) VisibilityResult {
	if input.IsDM {
		r := VisibilityResult{VisionAreas: []VisionArea{}}
		for _, t := range input.Tokens {
			r.VisibleTokenIDs = append(r.VisibleTokenIDs, t.ID)
		}
		for _, s := range input.Structures {
			r.VisibleStructureIDs = append(r.VisibleStructureIDs, s.ID)
		}
		return r
	}
	r := VisibilityResult{Fog: true, VisionAreas: []VisionArea{}}
	visibleStruct := map[string]bool{}
	visibleTok := map[string]bool{}
	for _, t := range input.Tokens {
		if t.OwnerUserID == input.UserID && !t.IsHidden {
			origin := Point{t.X, t.Y}
			r.VisionAreas = append(r.VisionAreas, VisionArea{TokenID: t.ID, Origin: origin, Polygon: castVision(origin, t.VisionRangeM, input.Structures)})
			visibleTok[t.ID] = true
			for _, s := range input.Structures {
				if structureVisible(origin, t, s) {
					visibleStruct[s.ID] = true
				}
			}
			for _, ot := range input.Tokens {
				if ot.IsHidden && ot.OwnerUserID != input.UserID {
					continue
				}
				if inRange(origin, Point{ot.X, ot.Y}, t.VisionRangeM) {
					visibleTok[ot.ID] = true
				}
			}
		}
	}
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

// TokenVisibleTo reports whether a player sees target, by the same rule as the room state:
// tokens they may move always; otherwise non-hidden tokens within the vision range of one of
// their own non-hidden tokens.
func TokenVisibleTo(userID string, target Token, tokens []Token) bool {
	if userID == "" {
		return false
	}
	if target.MovableBy(userID, false) {
		return true
	}
	if target.IsHidden {
		return false
	}
	for _, t := range tokens {
		if t.OwnerUserID == userID && !t.IsHidden && inRange(Point{t.X, t.Y}, Point{target.X, target.Y}, t.VisionRangeM) {
			return true
		}
	}
	return false
}

func inRange(origin, p Point, rangeM float64) bool { return DistanceMeters(origin, p) <= rangeM+1e-9 }

func structureVisible(origin Point, tok Token, st Structure) bool {
	if st.IsHidden {
		return false
	}
	for _, p := range st.Geometry {
		if inRange(origin, p, tok.VisionRangeM) {
			return true
		}
	}
	return false
}

// castVision returns the polygon a token sees: a full circle of radius rangeM around origin,
// cut short wherever a visible, vision-blocking structure is in the way.
func castVision(origin Point, rangeM float64, structures []Structure) []Point {
	const steps = 180
	angles := make([]float64, 0, steps)
	for i := range steps {
		angles = append(angles, float64(i)*2*math.Pi/steps)
	}
	normalize := func(a float64) float64 {
		a = math.Mod(a, 2*math.Pi)
		if a < 0 {
			a += 2 * math.Pi
		}
		return a
	}
	for _, st := range structures {
		if st.IsHidden || !st.BlocksVision {
			continue
		}
		for _, p := range st.Geometry {
			a := math.Atan2(p.Y-origin.Y, p.X-origin.X)
			angles = append(angles, normalize(a-0.0001), normalize(a), normalize(a+0.0001))
		}
	}
	sort.Float64s(angles)
	poly := make([]Point, 0, len(angles))
	for _, a := range angles {
		nearest := rangeM
		hit := Point{origin.X + math.Cos(a)*rangeM, origin.Y + math.Sin(a)*rangeM}
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
