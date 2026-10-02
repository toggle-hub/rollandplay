package game

import "encoding/json"

type Structure struct {
	ID             string          `json:"id"`
	Kind           string          `json:"kind"`
	Geometry       []Point         `json:"geometry"`
	BlocksVision   bool            `json:"blocks_vision"`
	BlocksMovement bool            `json:"blocks_movement"`
	BlocksAttacks  bool            `json:"blocks_attacks"`
	CoverBonus     int             `json:"cover_bonus"`
	PassRules      map[string]bool `json:"pass_rules"`
	IsHidden       bool            `json:"is_hidden"`
}
type Token struct {
	ID               string           `json:"id"`
	OwnerUserID      string           `json:"owner_user_id"`
	Name             string           `json:"name"`
	X                float64          `json:"x_m"`
	Y                float64          `json:"y_m"`
	RotationDeg      float64          `json:"rotation_deg"`
	SizeM            float64          `json:"size_m"`
	VisionRangeM     float64          `json:"vision_range_m"`
	VisionAngleDeg   float64          `json:"vision_angle_deg"`
	IsHidden         bool             `json:"is_hidden"`
	Attributes       map[string]any   `json:"attributes"`
	SheetID          string           `json:"sheet_id,omitempty"`
	SheetOwnerUserID string           `json:"-"`
	Stats            map[string]any   `json:"-"` // sheet data when sheet-backed, else token attributes
	Attacks          []ResolvedAttack `json:"attacks,omitempty"`
	AttacksEditable  bool             `json:"attacks_editable,omitempty"`
}

func CanMove(path []Point, structures []Structure, token Token) bool {
	return !crossesBlocked(path, structures, "movement")
}
func CanTarget(from, to Point, structures []Structure, token Token) bool {
	return !crossesBlocked([]Point{from, to}, structures, "attacks")
}

func crossesBlocked(path []Point, structures []Structure, rule string) bool {
	if len(path) < 2 {
		return false
	}
	for i := 0; i < len(path)-1; i++ {
		move := Segment{path[i], path[i+1]}
		for _, st := range structures {
			if st.IsHidden {
				continue
			}
			blocked := rule == "movement" && st.BlocksMovement || rule == "attacks" && st.BlocksAttacks
			if !blocked || st.PassRules[rule] {
				continue
			}
			for _, seg := range structureSegments(st) {
				if SegmentIntersects(move, seg) {
					return true
				}
			}
		}
	}
	return false
}

func structureSegments(st Structure) []Segment {
	pts := st.Geometry
	var segs []Segment
	if len(pts) < 2 {
		return segs
	}
	for i := 0; i < len(pts)-1; i++ {
		segs = append(segs, Segment{pts[i], pts[i+1]})
	}
	if len(pts) > 2 {
		segs = append(segs, Segment{pts[len(pts)-1], pts[0]})
	}
	return segs
}

func ParseStructure(id, kind string, geometryJSON, passRulesJSON []byte, bv, bm, ba bool, cover int) Structure {
	var pts []Point
	_ = json.Unmarshal(geometryJSON, &pts)
	pr := map[string]bool{}
	_ = json.Unmarshal(passRulesJSON, &pr)
	return Structure{ID: id, Kind: kind, Geometry: pts, BlocksVision: bv, BlocksMovement: bm, BlocksAttacks: ba, CoverBonus: cover, PassRules: pr}
}
