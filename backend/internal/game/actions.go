package game

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"
	"unicode/utf8"
)

// DamageTypes are the D&D 5e damage types an attack, action or defense may name.
var DamageTypes = []string{"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"}

// Action kinds: an attack roll against armor class, a saving throw against a DC, or healing.
const (
	ActionAttack = "attack"
	ActionSave   = "save"
	ActionHeal   = "heal"
)

// MaxActions and MaxItems cap how many spells/abilities and items one character may carry.
const (
	MaxActions = 30
	MaxItems   = 50
)

// Uses limits how often an action can be used until the owner restores it.
type Uses struct {
	Max       int `json:"max"`
	Remaining int `json:"remaining"`
}

// Action is a stored spell or ability, kept in sheet data or token attributes under "actions".
type Action struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Kind          string  `json:"kind"`
	RangeM        float64 `json:"range_m"`
	AreaRadiusM   float64 `json:"area_radius_m"` // 0 = one target; else every token around a point
	Ability       string  `json:"ability"`       // "" = none
	Proficient    bool    `json:"proficient"`
	Bonus         int     `json:"bonus"` // to hit for attacks, to the DC for saves
	SaveAbility   string  `json:"save_ability"`
	HalfOnSave    bool    `json:"half_on_save"`
	Dice          string  `json:"dice"`
	DiceBonus     int     `json:"dice_bonus"`
	AbilityToDice bool    `json:"ability_to_dice"`
	DamageType    string  `json:"damage_type"`
	Uses          *Uses   `json:"uses,omitempty"`
}

// Item is a consumable action, kept under "items"; each use spends one of Quantity.
type Item struct {
	Action
	Quantity int `json:"quantity"`
}

// ResolvedAction is an action with the character's stats folded into its numbers.
type ResolvedAction struct {
	Action
	ToHit        int `json:"to_hit"`
	SaveDC       int `json:"save_dc"`
	DiceModifier int `json:"dice_modifier"`
}

type ResolvedItem struct {
	ResolvedAction
	Quantity int `json:"quantity"`
}

// DeathSaves is a dying character's death saving throw state, stored on the sheet.
type DeathSaves struct {
	Successes int  `json:"successes"`
	Failures  int  `json:"failures"`
	Stable    bool `json:"stable"`
	Dead      bool `json:"dead"`
}

// Defenses are what an attacker is checked against: armor class and damage type adjustments.
type Defenses struct {
	ArmorClass      *int     `json:"armor_class"`
	Resistances     []string `json:"resistances"`
	Immunities      []string `json:"immunities"`
	Vulnerabilities []string `json:"vulnerabilities"`
}

func ParseActions(raw []byte) ([]Action, error) {
	actions, err := decodeActions(raw)
	if err != nil {
		return nil, err
	}
	if len(actions) > MaxActions {
		return nil, fmt.Errorf("a character can have at most %d spells and abilities", MaxActions)
	}
	return actions, nil
}

// decodeActions validates and normalizes an actions list without a length cap.
func decodeActions(raw []byte) ([]Action, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []Action{}, nil
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	var actions []Action
	if err := dec.Decode(&actions); err != nil {
		return nil, fmt.Errorf("actions must be a list of action objects")
	}
	if actions == nil {
		actions = []Action{}
	}
	seen := make(map[string]struct{}, len(actions))
	for i := range actions {
		if err := validateAction(&actions[i], i, "action", seen); err != nil {
			return nil, err
		}
	}
	return actions, nil
}

func ParseItems(raw []byte) ([]Item, error) {
	items, err := decodeItems(raw)
	if err != nil {
		return nil, err
	}
	if len(items) > MaxItems {
		return nil, fmt.Errorf("a character can have at most %d items", MaxItems)
	}
	return items, nil
}

// decodeItems validates and normalizes an items list without a length cap.
func decodeItems(raw []byte) ([]Item, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []Item{}, nil
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	var items []Item
	if err := dec.Decode(&items); err != nil {
		return nil, fmt.Errorf("items must be a list of item objects")
	}
	if items == nil {
		items = []Item{}
	}
	seen := make(map[string]struct{}, len(items))
	for i := range items {
		it := &items[i]
		if err := validateAction(&it.Action, i, "item", seen); err != nil {
			return nil, err
		}
		if it.Uses != nil {
			return nil, fmt.Errorf("item %q cannot have uses; use quantity", it.Name)
		}
		if it.Quantity < 1 || it.Quantity > 999 {
			return nil, fmt.Errorf("item %q quantity must be between 1 and 999", it.Name)
		}
	}
	return items, nil
}

// ValidateStatLists checks stats.attacks, stats.actions and stats.items with the character
// caps; missing keys are fine.
func ValidateStatLists(stats map[string]any) error {
	if v, ok := stats["attacks"]; ok {
		b, _ := json.Marshal(v)
		if _, err := ParseAttacks(b); err != nil {
			return err
		}
	}
	if v, ok := stats["actions"]; ok {
		b, _ := json.Marshal(v)
		if _, err := ParseActions(b); err != nil {
			return err
		}
	}
	if v, ok := stats["items"]; ok {
		b, _ := json.Marshal(v)
		if _, err := ParseItems(b); err != nil {
			return err
		}
	}
	return nil
}

// validateAction normalizes a and checks it; label ("action" or "item") prefixes errors.
func validateAction(a *Action, i int, label string, seen map[string]struct{}) error {
	a.Name = strings.TrimSpace(a.Name)
	a.Ability = strings.TrimSpace(a.Ability)
	a.SaveAbility = strings.TrimSpace(a.SaveAbility)
	a.DamageType = strings.TrimSpace(a.DamageType)
	a.Dice = strings.ReplaceAll(strings.TrimSpace(a.Dice), " ", "")
	if _, dup := seen[a.ID]; a.ID == "" || len(a.ID) > 64 || dup {
		return fmt.Errorf("%s %d needs a unique id", label, i+1)
	}
	seen[a.ID] = struct{}{}
	if a.Name == "" || utf8.RuneCountInString(a.Name) > 80 {
		return fmt.Errorf("%s %d needs a name of at most 80 characters", label, i+1)
	}
	switch a.Kind {
	case ActionAttack, ActionSave, ActionHeal:
	default:
		return fmt.Errorf("%s %q kind must be attack, save or heal", label, a.Name)
	}
	if !(a.RangeM > 0 && a.RangeM <= 1000) {
		return fmt.Errorf("%s %q range must be between 0 and 1000 meters", label, a.Name)
	}
	if !(a.AreaRadiusM >= 0 && a.AreaRadiusM <= 100) {
		return fmt.Errorf("%s %q area radius must be between 0 and 100 meters", label, a.Name)
	}
	if a.Kind == ActionAttack && a.AreaRadiusM != 0 {
		return fmt.Errorf("%s %q is an attack roll and cannot have an area", label, a.Name)
	}
	if len(a.Ability) > 64 {
		return fmt.Errorf("%s %q ability name is too long", label, a.Name)
	}
	if a.Bonus < -100 || a.Bonus > 100 || a.DiceBonus < -100 || a.DiceBonus > 100 {
		return fmt.Errorf("%s %q bonuses must be between -100 and 100", label, a.Name)
	}
	if a.Kind == ActionSave && !isAbility(a.SaveAbility) {
		return fmt.Errorf("%s %q save ability must be one of %s", label, a.Name, strings.Join(DnDAbilities, ", "))
	}
	if a.Kind != ActionSave && a.SaveAbility != "" {
		return fmt.Errorf("%s %q save ability is only for saving throws", label, a.Name)
	}
	if a.Kind != ActionSave && a.HalfOnSave {
		return fmt.Errorf("%s %q half on save is only for saving throws", label, a.Name)
	}
	if ValidateExpression(a.Dice) != nil {
		return fmt.Errorf("%s %q dice must be a dice expression such as 1d8+2", label, a.Name)
	}
	if a.DamageType != "" && !slices.Contains(DamageTypes, a.DamageType) {
		return fmt.Errorf("%s %q damage type must be one of %s", label, a.Name, strings.Join(DamageTypes, ", "))
	}
	if a.Kind == ActionHeal && a.DamageType != "" {
		return fmt.Errorf("%s %q heals and cannot have a damage type", label, a.Name)
	}
	if a.Uses != nil && (a.Uses.Max < 1 || a.Uses.Max > 100 || a.Uses.Remaining < 0 || a.Uses.Remaining > a.Uses.Max) {
		return fmt.Errorf("%s %q uses must have a max from 1 to 100 and remaining from 0 to max", label, a.Name)
	}
	return nil
}

// ResolveAction folds the character's ability modifier and proficiency into the action.
// Fields that do not apply to the action's kind stay 0.
func ResolveAction(a Action, stats map[string]any) ResolvedAction {
	mod, prof := abilityMod(stats, a.Ability), 0
	if a.Proficient {
		if bonus, ok := stats["proficiency_bonus"].(float64); ok {
			prof = int(math.Round(bonus))
		}
	}
	r := ResolvedAction{Action: a, DiceModifier: a.DiceBonus}
	if a.AbilityToDice {
		r.DiceModifier += mod
	}
	switch a.Kind {
	case ActionAttack:
		r.ToHit = mod + prof + a.Bonus
	case ActionSave:
		r.SaveDC = 8 + mod + prof + a.Bonus
	}
	return r
}

func ResolveActions(as []Action, stats map[string]any) []ResolvedAction {
	out := make([]ResolvedAction, 0, len(as))
	for _, a := range as {
		out = append(out, ResolveAction(a, stats))
	}
	return out
}

func ResolveItems(is []Item, stats map[string]any) []ResolvedItem {
	out := make([]ResolvedItem, 0, len(is))
	for _, it := range is {
		out = append(out, ResolvedItem{ResolvedAction: ResolveAction(it.Action, stats), Quantity: it.Quantity})
	}
	return out
}

// ActionList parses the spells and abilities stored in the token's stats.
func (t Token) ActionList() ([]Action, error) {
	raw, err := json.Marshal(t.Stats["actions"])
	if err != nil {
		return nil, err
	}
	return ParseActions(raw)
}

// ItemList parses the items stored in the token's stats.
func (t Token) ItemList() ([]Item, error) {
	raw, err := json.Marshal(t.Stats["items"])
	if err != nil {
		return nil, err
	}
	return ParseItems(raw)
}

// AsAction is the attack as an attack-roll action; its ability modifier always adds to damage.
func (a Attack) AsAction() Action {
	return Action{ID: a.ID, Name: a.Name, Kind: ActionAttack, RangeM: a.RangeM, Ability: a.Ability, Proficient: a.Proficient,
		Bonus: a.AttackBonus, Dice: a.Damage, DiceBonus: a.DamageBonus, AbilityToDice: true, DamageType: a.DamageType}
}

// DeathSaveState reads the death save counters; missing values count as 0 or false.
func DeathSaveState(stats map[string]any) DeathSaves {
	s := DeathSaves{}
	if n := statInt(stats, "death_save_successes"); n != nil {
		s.Successes = *n
	}
	if n := statInt(stats, "death_save_failures"); n != nil {
		s.Failures = *n
	}
	s.Stable, _ = stats["stable"].(bool)
	s.Dead, _ = stats["dead"].(bool)
	return s
}

// DefenseState reads armor class and the damage type lists; unknown types are dropped.
func DefenseState(stats map[string]any) Defenses {
	return Defenses{
		ArmorClass:      statInt(stats, "armor_class"),
		Resistances:     damageTypeList(stats["resistances"]),
		Immunities:      damageTypeList(stats["immunities"]),
		Vulnerabilities: damageTypeList(stats["vulnerabilities"]),
	}
}

func damageTypeList(v any) []string {
	out := []string{}
	list, _ := v.([]any)
	for _, item := range list {
		if s, ok := item.(string); ok && slices.Contains(DamageTypes, s) && !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	return out
}

// IsDown: the character has numeric health with a positive maximum and is at 0 HP or below.
func IsDown(stats map[string]any) bool {
	hp, max := statInt(stats, "hit_points"), statInt(stats, "max_hit_points")
	return hp != nil && max != nil && *max > 0 && *hp <= 0
}

func IsDead(stats map[string]any) bool {
	dead, _ := stats["dead"].(bool)
	return dead
}
