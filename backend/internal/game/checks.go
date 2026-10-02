package game

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

// Check kinds a game master can prompt. ability/save/skill use the D&D 5e rules on the
// built-in book's keys; attribute adds a numeric sheet value as-is, for any rule book.
const (
	CheckAbility   = "ability"
	CheckSave      = "save"
	CheckSkill     = "skill"
	CheckAttribute = "attribute"
)

var DnDAbilities = []string{"strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"}

// DnDSkillAbility maps the built-in book's skill_proficiencies keys to their 5e (2014) ability.
var DnDSkillAbility = map[string]string{
	"acrobatics": "dexterity", "animal_handling": "wisdom", "arcana": "intelligence", "athletics": "strength",
	"deception": "charisma", "history": "intelligence", "insight": "wisdom", "intimidation": "charisma",
	"investigation": "intelligence", "medicine": "wisdom", "nature": "intelligence", "perception": "wisdom",
	"performance": "charisma", "persuasion": "charisma", "religion": "intelligence", "sleight_of_hand": "dexterity",
	"stealth": "dexterity", "survival": "wisdom",
}

var attributeKeyRE = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

type Check struct {
	Kind string `json:"kind"`
	Key  string `json:"key"`
}

func (c Check) Validate() error {
	switch c.Kind {
	case CheckAbility, CheckSave:
		if !isAbility(c.Key) {
			return fmt.Errorf("unknown ability %q", c.Key)
		}
	case CheckSkill:
		if _, ok := DnDSkillAbility[c.Key]; !ok {
			return fmt.Errorf("unknown skill %q", c.Key)
		}
	case CheckAttribute:
		if !attributeKeyRE.MatchString(c.Key) {
			return fmt.Errorf("attribute must be a sheet key such as speed_m")
		}
	default:
		return fmt.Errorf("check kind must be ability, save, skill or attribute")
	}
	return nil
}

// Label is the player-facing name, e.g. "Dexterity saving throw" or "Stealth check".
func (c Check) Label() string {
	switch c.Kind {
	case CheckSave:
		return humanize(c.Key) + " saving throw"
	default:
		return humanize(c.Key) + " check"
	}
}

// Modifier is added to 1d20. Missing or non-numeric sheet values count as 0, like attacks.
func (c Check) Modifier(stats map[string]any) int {
	switch c.Kind {
	case CheckAbility:
		return abilityMod(stats, c.Key)
	case CheckSave:
		return abilityMod(stats, c.Key) + proficiency(stats, "saving_throw_proficiencies", c.Key)
	case CheckSkill:
		return abilityMod(stats, DnDSkillAbility[c.Key]) + proficiency(stats, "skill_proficiencies", c.Key)
	case CheckAttribute:
		if v, ok := stats[c.Key].(float64); ok {
			return int(math.Round(v))
		}
	}
	return 0
}

// Expression is the dice expression rolled for this check, e.g. "1d20+3".
func (c Check) Expression(stats map[string]any) string {
	return withModifier("1d20", c.Modifier(stats))
}

// CheckOutcome is stored with a check roll in chat: success means total >= DC.
type CheckOutcome struct {
	CheckID       string `json:"check_id"`
	Title         string `json:"title"`
	Label         string `json:"label"`
	DC            int    `json:"dc"`
	Success       bool   `json:"success"`
	UserID        string `json:"user_id"`
	CharacterName string `json:"character_name"`
}

type CheckRoll struct {
	RollResult
	Check CheckOutcome `json:"check"`
}

func abilityMod(stats map[string]any, ability string) int {
	if score, ok := stats[ability].(float64); ok {
		return AbilityModifier(score)
	}
	return 0
}

func proficiency(stats map[string]any, group, key string) int {
	flags, _ := stats[group].(map[string]any)
	if proficient, _ := flags[key].(bool); !proficient {
		return 0
	}
	if bonus, ok := stats["proficiency_bonus"].(float64); ok {
		return int(math.Round(bonus))
	}
	return 0
}

func isAbility(key string) bool {
	for _, a := range DnDAbilities {
		if a == key {
			return true
		}
	}
	return false
}

func humanize(key string) string {
	s := strings.ReplaceAll(key, "_", " ")
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
