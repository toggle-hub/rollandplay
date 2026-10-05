package game

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
)

var (
	ErrUnknownAction = errors.New("action not found")
	ErrNoUses        = errors.New("no uses left")
)

// Target results, as stored in TargetOutcome.Result.
const (
	ResultHit      = "hit"
	ResultCritical = "critical"
	ResultMiss     = "miss"
	ResultSaved    = "saved"
	ResultFailed   = "failed"
	ResultHealed   = "healed"
	ResultNoEffect = "no_effect"
	ResultSuccess  = "success"
	ResultFailure  = "failure"
	ResultStable   = "stable"
	ResultDead     = "dead"
	ResultRevived  = "revived"
)

// ActionRoll is a resolved action as stored in chat_messages.roll and broadcast.
type ActionRoll struct {
	Action ActionOutcome `json:"action"`
}

// ActionOutcome never carries a target's armor class, health or save modifier.
type ActionOutcome struct {
	Name          string          `json:"name"`
	Kind          string          `json:"kind"`   // attack|save|heal|death_save
	Source        string          `json:"source"` // attack|action|item|death_save
	SourceTokenID string          `json:"source_token_id"`
	DC            int             `json:"dc,omitempty"`
	SaveAbility   string          `json:"save_ability,omitempty"`
	DamageType    string          `json:"damage_type,omitempty"`
	Effect        *RollResult     `json:"effect,omitempty"` // the shared damage or healing roll
	Targets       []TargetOutcome `json:"targets"`
	UsesLeft      *int            `json:"uses_left,omitempty"`
	QuantityLeft  *int            `json:"quantity_left,omitempty"`
}

type TargetOutcome struct {
	TokenID string      `json:"token_id"`
	Name    string      `json:"name"`
	Roll    *RollResult `json:"roll,omitempty"` // attack d20, the target's save, or the death save
	Result  string      `json:"result"`
	Damage  int         `json:"damage,omitempty"`
	Healing int         `json:"healing,omitempty"`
	Defense string      `json:"defense,omitempty"` // resistant|immune|vulnerable
	Down    bool        `json:"down,omitempty"`
	Dead    bool        `json:"dead,omitempty"`
}

// Target is a token an action lands on, with its current stats.
type Target struct {
	TokenID, Name string
	Stats         map[string]any
	SheetBacked   bool
}

func (t Target) outcome() TargetOutcome { return TargetOutcome{TokenID: t.TokenID, Name: t.Name} }

var diceTermRE = regexp.MustCompile(`([0-9]*)d([0-9]+)`)

// DoubleDice doubles every dice count in a normalized expression (a critical hit), capped
// at the roller's 100 dice per term. Flat terms are unchanged.
func DoubleDice(expr string) string {
	return diceTermRE.ReplaceAllStringFunc(expr, func(term string) string {
		m := diceTermRE.FindStringSubmatch(term)
		n := 1
		if m[1] != "" {
			n, _ = strconv.Atoi(m[1])
		}
		return fmt.Sprintf("%dd%s", min(2*n, 100), m[2])
	})
}

// applyDamage spends temporary hit points first, then hit points down to 0. Damage to a
// sheet-backed character already at 0 HP is a failed death save (two on a critical hit).
func applyDamage(t Target, amount int, critical bool) (TargetOutcome, map[string]any) {
	out := t.outcome()
	out.Damage = amount
	hp := statInt(t.Stats, "hit_points")
	if hp == nil || amount <= 0 {
		return out, nil
	}
	patch := map[string]any{}
	rest := amount
	if temp := statInt(t.Stats, "temporary_hit_points"); temp != nil && *temp > 0 {
		absorbed := min(*temp, rest)
		rest -= absorbed
		patch["temporary_hit_points"] = *temp - absorbed
	}
	next := max(0, *hp-rest)
	patch["hit_points"] = next
	out.Down = *hp > 0 && next == 0
	if t.SheetBacked && *hp <= 0 && rest > 0 && !IsDead(t.Stats) {
		failures := DeathSaveState(t.Stats).Failures + 1
		if critical {
			failures++
		}
		patch["death_save_failures"] = failures
		patch["stable"] = false
		if failures >= 3 {
			patch["dead"] = true
			out.Dead = true
		}
	}
	return out, patch
}

// adjustForDefenses applies immunity, then resistance (halved, rounded down), then
// vulnerability (doubled). The label names the one adjustment that applied, if only one did.
func adjustForDefenses(stats map[string]any, damageType string, amount int) (int, string) {
	if damageType == "" {
		return amount, ""
	}
	d := DefenseState(stats)
	if slices.Contains(d.Immunities, damageType) {
		return 0, "immune"
	}
	resistant, vulnerable := slices.Contains(d.Resistances, damageType), slices.Contains(d.Vulnerabilities, damageType)
	if resistant {
		amount /= 2
	}
	if vulnerable {
		amount *= 2
	}
	switch {
	case resistant && !vulnerable:
		return amount, "resistant"
	case vulnerable && !resistant:
		return amount, "vulnerable"
	}
	return amount, ""
}

// RollAttack rolls to hit against the target's armor class (10 when unset), with the attacker's
// advantage, disadvantage and bonus. A natural 20 on the kept d20 always hits and doubles the
// damage dice; a natural 1 always misses. The damage roll is returned for the outcome's Effect
// and is nil on a miss.
func RollAttack(a ResolvedAction, t Target, opts RollOptions, rng io.Reader) (TargetOutcome, *RollResult, map[string]any, error) {
	roll, err := RollExpression(opts.D20(a.ToHit), rng)
	if err != nil {
		return TargetOutcome{}, nil, nil, err
	}
	nat := roll.Natural()
	ac := 10
	if v := statInt(t.Stats, "armor_class"); v != nil {
		ac = *v
	}
	if nat != 20 && (nat == 1 || roll.Total < ac) {
		out := t.outcome()
		out.Roll, out.Result = &roll, ResultMiss
		return out, nil, nil, nil
	}
	critical := nat == 20
	dice := a.Dice
	if critical {
		dice = DoubleDice(dice)
	}
	dmg, err := RollExpression(withModifier(dice, a.DiceModifier), rng)
	if err != nil {
		return TargetOutcome{}, nil, nil, err
	}
	amount, defense := adjustForDefenses(t.Stats, a.DamageType, max(0, dmg.Total))
	out, patch := applyDamage(t, amount, critical)
	out.Roll, out.Result, out.Defense = &roll, ResultHit, defense
	if critical {
		out.Result = ResultCritical
	}
	return out, &dmg, patch, nil
}

// RollEffect rolls a save or heal action's damage or healing once for all its targets.
func RollEffect(a ResolvedAction, rng io.Reader) (RollResult, error) {
	return RollExpression(withModifier(a.Dice, a.DiceModifier), rng)
}

// ResolveSave has the target roll its saving throw against the action's DC. A save halves
// the damage with HalfOnSave and prevents it otherwise.
func ResolveSave(a ResolvedAction, effectTotal int, t Target, rng io.Reader) (TargetOutcome, map[string]any, error) {
	roll, err := RollExpression(Check{Kind: CheckSave, Key: a.SaveAbility}.Expression(t.Stats), rng)
	if err != nil {
		return TargetOutcome{}, nil, err
	}
	saved := roll.Total >= a.SaveDC
	damage := max(0, effectTotal)
	if saved && a.HalfOnSave {
		damage /= 2
	} else if saved {
		damage = 0
	}
	amount, defense := adjustForDefenses(t.Stats, a.DamageType, damage)
	out, patch := applyDamage(t, amount, false)
	out.Roll, out.Defense, out.Result = &roll, defense, ResultFailed
	if saved {
		out.Result = ResultSaved
	}
	return out, patch, nil
}

// ApplyHealing raises hit points up to the maximum (when one is set). Healing a dying
// character above 0 HP clears its death saves. The dead cannot be healed.
func ApplyHealing(amount int, t Target) (TargetOutcome, map[string]any) {
	out := t.outcome()
	if IsDead(t.Stats) {
		out.Result = ResultNoEffect
		return out, nil
	}
	out.Result = ResultHealed
	hp, maxHP := statInt(t.Stats, "hit_points"), statInt(t.Stats, "max_hit_points")
	if hp == nil {
		out.Healing = amount
		return out, nil
	}
	base := max(0, *hp)
	next := base + amount
	if maxHP != nil && *maxHP > 0 && next > *maxHP {
		next = max(base, *maxHP)
	}
	out.Healing = next - base
	patch := map[string]any{"hit_points": next}
	if next > 0 && t.SheetBacked {
		patch["death_save_successes"] = 0
		patch["death_save_failures"] = 0
		patch["stable"] = false
	}
	return out, patch
}

// DeathSave rolls a dying character's death saving throw, with the roller's advantage,
// disadvantage and bonus: a natural 20 revives with 1 HP, a natural 1 counts as two failures,
// otherwise a total of 10 or more succeeds (three successes stabilize); three failures kill.
func DeathSave(t Target, opts RollOptions, rng io.Reader) (TargetOutcome, map[string]any, error) {
	roll, err := RollExpression(opts.D20(0), rng)
	if err != nil {
		return TargetOutcome{}, nil, err
	}
	nat := roll.Natural()
	state := DeathSaveState(t.Stats)
	out := t.outcome()
	out.Roll = &roll
	var patch map[string]any
	switch {
	case nat == 20:
		out.Result = ResultRevived
		patch = map[string]any{"hit_points": 1, "death_save_successes": 0, "death_save_failures": 0, "stable": false}
	case nat != 1 && roll.Total >= 10:
		if state.Successes+1 >= 3 {
			out.Result = ResultStable
			patch = map[string]any{"stable": true, "death_save_successes": 0, "death_save_failures": 0}
		} else {
			out.Result = ResultSuccess
			patch = map[string]any{"death_save_successes": state.Successes + 1}
		}
	default:
		failures := state.Failures + 1
		if nat == 1 {
			failures++
		}
		patch = map[string]any{"death_save_failures": failures}
		out.Result = ResultFailure
		if failures >= 3 {
			patch["dead"] = true
			out.Result, out.Dead = ResultDead, true
		}
	}
	return out, patch, nil
}

// ConsumeUse spends one use of a limited action. Unlimited actions return the list
// unchanged and a nil count.
func ConsumeUse(stats map[string]any, actionID string) ([]Action, *int, error) {
	raw, err := json.Marshal(stats["actions"])
	if err != nil {
		return nil, nil, err
	}
	actions, err := ParseActions(raw)
	if err != nil {
		return nil, nil, err
	}
	i := slices.IndexFunc(actions, func(a Action) bool { return a.ID == actionID })
	if i < 0 {
		return nil, nil, ErrUnknownAction
	}
	uses := actions[i].Uses
	if uses == nil {
		return actions, nil, nil
	}
	if uses.Remaining <= 0 {
		return nil, nil, ErrNoUses
	}
	uses.Remaining--
	left := uses.Remaining
	return actions, &left, nil
}

// ConsumeItem spends one of an item and drops it from the list once none are left.
func ConsumeItem(stats map[string]any, itemID string) ([]Item, int, error) {
	raw, err := json.Marshal(stats["items"])
	if err != nil {
		return nil, 0, err
	}
	items, err := ParseItems(raw)
	if err != nil {
		return nil, 0, err
	}
	i := slices.IndexFunc(items, func(it Item) bool { return it.ID == itemID })
	if i < 0 {
		return nil, 0, ErrUnknownAction
	}
	items[i].Quantity--
	left := items[i].Quantity
	if left <= 0 {
		items = slices.Delete(items, i, i+1)
	}
	return items, left, nil
}
