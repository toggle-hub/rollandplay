package game

import (
	"encoding/json"
	"math"
	"slices"
)

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
	IsHidden         bool             `json:"is_hidden"`
	Attributes       map[string]any   `json:"attributes"`
	SheetID          string           `json:"sheet_id,omitempty"`
	SheetOwnerUserID string           `json:"-"`
	Stats            map[string]any   `json:"-"` // sheet data when sheet-backed, else token attributes
	Attacks          []ResolvedAttack `json:"attacks,omitempty"`
	Actions          []ResolvedAction `json:"actions,omitempty"`
	Items            []ResolvedItem   `json:"items,omitempty"`
	ActionsEditable  bool             `json:"actions_editable,omitempty"` // per viewer: attacks, actions and items
	CanAct           bool             `json:"can_act,omitempty"`          // per viewer: DM or owner
	ImageAssetID     string           `json:"image_asset_id,omitempty"`
	MoverUserIDs     []string         `json:"mover_user_ids,omitempty"` // sent to game masters only
	CanMove          bool             `json:"can_move,omitempty"`       // per viewer
	HitPoints        *int             `json:"hit_points,omitempty"`     // per viewer: DM, owner, sheet owner
	MaxHitPoints     *int             `json:"max_hit_points,omitempty"`
	DeathSaves       *DeathSaves      `json:"death_saves,omitempty"`          // same viewers as health, sheet-backed only
	Defenses         *Defenses        `json:"defenses,omitempty"`             // same viewers as health
	TempHitPoints    *int             `json:"temporary_hit_points,omitempty"` // same viewers as health
	Conditions       []string         `json:"conditions"`                     // everyone at the table
	Status           string           `json:"status,omitempty"`               // everyone: down|stable|dead, never HP numbers
	Side             string           `json:"side,omitempty"`                 // per viewer: own|party|npc
}

// MovableBy reports whether userID may move the token: its owner, the game master,
// or a player the game master granted move rights.
func (t Token) MovableBy(userID string, isDM bool) bool {
	return isDM || t.OwnerUserID == userID || slices.Contains(t.MoverUserIDs, userID)
}

// Health reads current and maximum hit points from the token's stats; non-numeric values are nil.
func (t Token) Health() (hp, max *int) {
	return statInt(t.Stats, "hit_points"), statInt(t.Stats, "max_hit_points")
}

// statInt reads a whole number from stats: JSON numbers decode as float64, while patches
// applied in memory during combat hold ints. Anything else is nil.
func statInt(stats map[string]any, key string) *int {
	switch v := stats[key].(type) {
	case int:
		return &v
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil
		}
		n := int(math.Round(v))
		return &n
	}
	return nil
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
