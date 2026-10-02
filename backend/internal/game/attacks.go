package game

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

// MaxAttacks caps how many attacks one character may carry.
const MaxAttacks = 20

// Attack is a stored attack definition, kept in sheet data or token attributes under "attacks".
type Attack struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	RangeM      float64 `json:"range_m"`
	Ability     string  `json:"ability"` // "" = none
	Proficient  bool    `json:"proficient"`
	AttackBonus int     `json:"attack_bonus"`
	Damage      string  `json:"damage"` // dice expression, e.g. "1d8"
	DamageBonus int     `json:"damage_bonus"`
}

// ResolvedAttack is an attack with the character's stats folded into its modifiers.
type ResolvedAttack struct {
	Attack
	ToHit          int `json:"to_hit"`
	DamageModifier int `json:"damage_modifier"`
}

// AttackRoll is the attack roll plus its damage roll, stored as one chat roll.
type AttackRoll struct {
	RollResult
	Damage RollResult `json:"damage"`
}

func ParseAttacks(raw []byte) ([]Attack, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []Attack{}, nil
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	var attacks []Attack
	if err := dec.Decode(&attacks); err != nil {
		return nil, fmt.Errorf("attacks must be a list of attack objects")
	}
	if attacks == nil {
		attacks = []Attack{}
	}
	if len(attacks) > MaxAttacks {
		return nil, fmt.Errorf("a character can have at most %d attacks", MaxAttacks)
	}
	seen := make(map[string]struct{}, len(attacks))
	for i := range attacks {
		a := &attacks[i]
		a.Name = strings.TrimSpace(a.Name)
		a.Ability = strings.TrimSpace(a.Ability)
		a.Damage = strings.ReplaceAll(strings.TrimSpace(a.Damage), " ", "")
		if _, dup := seen[a.ID]; a.ID == "" || len(a.ID) > 64 || dup {
			return nil, fmt.Errorf("attack %d needs a unique id", i+1)
		}
		seen[a.ID] = struct{}{}
		if a.Name == "" || utf8.RuneCountInString(a.Name) > 80 {
			return nil, fmt.Errorf("attack %d needs a name of at most 80 characters", i+1)
		}
		if !(a.RangeM > 0 && a.RangeM <= 1000) {
			return nil, fmt.Errorf("attack %q range must be between 0 and 1000 meters", a.Name)
		}
		if len(a.Ability) > 64 {
			return nil, fmt.Errorf("attack %q ability name is too long", a.Name)
		}
		if a.AttackBonus < -100 || a.AttackBonus > 100 || a.DamageBonus < -100 || a.DamageBonus > 100 {
			return nil, fmt.Errorf("attack %q bonuses must be between -100 and 100", a.Name)
		}
		if ValidateExpression(a.Damage) != nil {
			return nil, fmt.Errorf("attack %q damage must be a dice expression such as 1d8+2", a.Name)
		}
	}
	return attacks, nil
}

// AbilityModifier is the D&D ability modifier: floor((score-10)/2).
func AbilityModifier(score float64) int { return int(math.Floor((score - 10) / 2)) }

func ResolveAttack(a Attack, stats map[string]any) ResolvedAttack {
	mod, prof := 0, 0
	if a.Ability != "" {
		if score, ok := stats[a.Ability].(float64); ok {
			mod = AbilityModifier(score)
		}
	}
	if a.Proficient {
		if bonus, ok := stats["proficiency_bonus"].(float64); ok {
			prof = int(math.Round(bonus))
		}
	}
	return ResolvedAttack{Attack: a, ToHit: mod + prof + a.AttackBonus, DamageModifier: mod + a.DamageBonus}
}

func ResolveAttacks(attacks []Attack, stats map[string]any) []ResolvedAttack {
	out := make([]ResolvedAttack, 0, len(attacks))
	for _, a := range attacks {
		out = append(out, ResolveAttack(a, stats))
	}
	return out
}

// InAttackRange measures center to center, like the ruler.
func InAttackRange(from, to Point, rangeM float64) bool {
	return DistanceMeters(from, to) <= rangeM+1e-9
}

func (r ResolvedAttack) AttackExpression() string { return withModifier("1d20", r.ToHit) }
func (r ResolvedAttack) DamageExpression() string { return withModifier(r.Damage, r.DamageModifier) }

func withModifier(base string, m int) string {
	if m == 0 {
		return base
	}
	return fmt.Sprintf("%s%+d", base, m)
}

// AttackList parses the attacks stored in the token's stats (sheet data or token attributes).
func (t Token) AttackList() ([]Attack, error) {
	raw, err := json.Marshal(t.Stats["attacks"])
	if err != nil {
		return nil, err
	}
	return ParseAttacks(raw)
}

// CanEditAttacks: sheet-backed tokens belong to the sheet owner; sheetless tokens to the DM.
func (t Token) CanEditAttacks(userID string, isDM bool) bool {
	if t.SheetID != "" {
		return t.SheetOwnerUserID == userID
	}
	return isDM
}
