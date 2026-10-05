package game

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// Conditions are the D&D 5e conditions plus concentrating, stored by these keys. Tokens may
// also carry the game master's own words, kept as typed.
var Conditions = []string{
	"blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible",
	"paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious", "concentrating",
}

const (
	MaxConditions      = 12
	MaxConditionLength = 32
)

// NormalizeConditions trims and dedupes a token's conditions, case-insensitively. Known
// conditions are stored by their lowercase key; blank entries are dropped.
func NormalizeConditions(in []string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range in {
		name := strings.Join(strings.Fields(raw), " ")
		if name == "" {
			continue
		}
		if len([]rune(name)) > MaxConditionLength {
			return nil, fmt.Errorf("a condition can be at most %d characters", MaxConditionLength)
		}
		folded := strings.ToLower(name)
		if slices.Contains(Conditions, folded) {
			name = folded
		}
		if seen[folded] {
			continue
		}
		seen[folded] = true
		out = append(out, name)
	}
	if len(out) > MaxConditions {
		return nil, fmt.Errorf("a token can have at most %d conditions", MaxConditions)
	}
	return out, nil
}

// Health states everyone at the table sees on a token, without its hit points.
const (
	StatusDown   = "down"
	StatusStable = "stable"
	StatusDead   = "dead"
)

// HealthStatus is "dead" after three failed death saves, "stable" or "down" at 0 HP, else "".
func HealthStatus(stats map[string]any) string {
	switch {
	case IsDead(stats):
		return StatusDead
	case !IsDown(stats):
		return ""
	case DeathSaveState(stats).Stable:
		return StatusStable
	default:
		return StatusDown
	}
}

// Token sides, as one viewer sees them.
const (
	SideOwn   = "own"
	SideParty = "party"
	SideNPC   = "npc"
)

// Player is the player a token belongs to: its owner when that is not a game master, else the
// owner of its sheet when that is not a game master. Tokens only game masters control have none.
func (t Token) Player(gameMasterIDs []string) string {
	if t.OwnerUserID != "" && !slices.Contains(gameMasterIDs, t.OwnerUserID) {
		return t.OwnerUserID
	}
	if t.SheetOwnerUserID != "" && !slices.Contains(gameMasterIDs, t.SheetOwnerUserID) {
		return t.SheetOwnerUserID
	}
	return ""
}

// SideFor: a player's character is "own" to that player and "party" to everyone else; tokens
// only game masters control (monsters and other NPCs) are "npc".
func (t Token) SideFor(viewerID string, gameMasterIDs []string) string {
	switch player := t.Player(gameMasterIDs); {
	case player == "":
		return SideNPC
	case player == viewerID:
		return SideOwn
	default:
		return SideParty
	}
}

// TempHealth reads the token's temporary hit points; a non-numeric value is nil.
func (t Token) TempHealth() *int {
	return statInt(t.Stats, "temporary_hit_points")
}

// Errors from AdjustHealth.
var (
	ErrNoHealth   = errors.New("no hit points")
	ErrDeadTarget = errors.New("the dead cannot be healed")
)

// AdjustHealth deals damage the way a hit does (temporary hit points first, a failed death save
// for a character already at 0 HP) or heals the way a healing action does, without a roll.
func AdjustHealth(t Target, damage, heal int) (map[string]any, error) {
	if statInt(t.Stats, "hit_points") == nil {
		return nil, ErrNoHealth
	}
	if damage > 0 {
		_, patch := applyDamage(t, damage, false)
		return patch, nil
	}
	if IsDead(t.Stats) {
		return nil, ErrDeadTarget
	}
	_, patch := ApplyHealing(heal, t)
	return patch, nil
}

// LongRest restores hit points to the maximum, clears temporary hit points and death saves,
// and refills every limited use of the token's actions. Items are not restocked. It returns
// only the stats that change; the dead do not rest.
func LongRest(t Target) map[string]any {
	patch := map[string]any{}
	if IsDead(t.Stats) {
		return patch
	}
	if hp, maxHP := statInt(t.Stats, "hit_points"), statInt(t.Stats, "max_hit_points"); maxHP != nil && *maxHP > 0 && (hp == nil || *hp != *maxHP) {
		patch["hit_points"] = *maxHP
	}
	if temp := statInt(t.Stats, "temporary_hit_points"); temp != nil && *temp != 0 {
		patch["temporary_hit_points"] = 0
	}
	if saves := DeathSaveState(t.Stats); t.SheetBacked && (saves.Successes != 0 || saves.Failures != 0 || saves.Stable) {
		patch["death_save_successes"] = 0
		patch["death_save_failures"] = 0
		patch["stable"] = false
	}
	// A malformed actions list is left for its editor to fix; the rest still happens.
	raw, err := json.Marshal(t.Stats["actions"])
	if err != nil {
		return patch
	}
	actions, err := decodeActions(raw)
	if err != nil {
		return patch
	}
	refilled := false
	for i := range actions {
		if uses := actions[i].Uses; uses != nil && uses.Remaining != uses.Max {
			uses.Remaining = uses.Max
			refilled = true
		}
	}
	if refilled {
		patch["actions"] = actions
	}
	return patch
}
