package game

import (
	"cmp"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

type DieRoll struct {
	Count  int   `json:"count"`
	Sides  int   `json:"sides"`
	Values []int `json:"values"`
	// Keep is "kh" (keep the highest) or "kl" (keep the lowest) on a keep term such as 2d20kh1.
	// Kept then marks, per value, the dice that count toward the total.
	Keep string `json:"keep,omitempty"`
	Kept []bool `json:"kept,omitempty"`
}
type RollResult struct {
	Expression string    `json:"expression"`
	Dice       []DieRoll `json:"dice"`
	Modifier   int       `json:"modifier"`
	Total      int       `json:"total"`
}

// A term is NdM, NdMkhK, NdMklK or a whole number; terms are joined by + and -.
var (
	diceExprRE      = regexp.MustCompile(`^[+-]?([0-9]*d[0-9]+(k[hl][0-9]+)?|[0-9]+)([+-]([0-9]*d[0-9]+(k[hl][0-9]+)?|[0-9]+))*$`)
	signedTermRE    = regexp.MustCompile(`[+-][^+-]+`)
	diceTermPartsRE = regexp.MustCompile(`^([0-9]*)d([0-9]+)(?:(kh|kl)([0-9]+))?$`)
)

// Caps on one dice term: at most 100 dice of at most 1000 sides.
const (
	maxDiceCount = 100
	maxDieSides  = 1000
)

func RollExpression(expression string, rng io.Reader) (RollResult, error) {
	expr := strings.ReplaceAll(strings.TrimSpace(expression), " ", "")
	if expr == "" || !diceExprRE.MatchString(expr) {
		return RollResult{}, fmt.Errorf("invalid roll expression")
	}
	if rng == nil {
		rng = rand.Reader
	}
	res := RollResult{Expression: expr}
	if expr[0] != '+' && expr[0] != '-' {
		expr = "+" + expr
	}
	for _, p := range signedTermRE.FindAllString(expr, -1) {
		sign := 1
		if p[0] == '-' {
			sign = -1
		}
		term := p[1:]
		m := diceTermPartsRE.FindStringSubmatch(term)
		if m == nil {
			v, err := strconv.Atoi(term)
			if err != nil {
				return res, err
			}
			res.Modifier += sign * v
			res.Total += sign * v
			continue
		}
		count := 1
		if m[1] != "" {
			v, err := strconv.Atoi(m[1])
			if err != nil {
				return res, err
			}
			count = v
		}
		sides, err := strconv.Atoi(m[2])
		if err != nil {
			return res, err
		}
		if count < 1 || count > maxDiceCount || sides < 1 || sides > maxDieSides {
			return res, fmt.Errorf("dice cap exceeded")
		}
		dr := DieRoll{Count: count, Sides: sides, Keep: m[3]}
		keep := count
		if dr.Keep != "" {
			keep, err = strconv.Atoi(m[4])
			if err != nil || keep < 1 || keep > count {
				return res, fmt.Errorf("keep between 1 and %d of %s", count, term[:strings.IndexByte(term, 'k')])
			}
		}
		for i := 0; i < count; i++ {
			v, err := rollOne(rng, sides)
			if err != nil {
				return res, err
			}
			dr.Values = append(dr.Values, v)
		}
		if dr.Keep != "" {
			dr.Kept = keptDice(dr.Values, dr.Keep == "kh", keep)
		}
		for i, v := range dr.Values {
			if dr.Kept == nil || dr.Kept[i] {
				res.Total += sign * v
			}
		}
		res.Dice = append(res.Dice, dr)
	}
	return res, nil
}

// keptDice marks the keep highest (or lowest) values; among equal values the earlier die is kept.
func keptDice(values []int, highest bool, keep int) []bool {
	order := make([]int, len(values))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int {
		if highest {
			return cmp.Compare(values[b], values[a])
		}
		return cmp.Compare(values[a], values[b])
	})
	kept := make([]bool, len(values))
	for _, i := range order[:keep] {
		kept[i] = true
	}
	return kept
}

// Natural is the first counted die of the first dice term: the d20 that decides natural 1s and 20s.
func (r RollResult) Natural() int {
	if len(r.Dice) == 0 {
		return 0
	}
	d := r.Dice[0]
	for i, v := range d.Values {
		if d.Kept == nil || d.Kept[i] {
			return v
		}
	}
	return 0
}

func rollOne(r io.Reader, sides int) (int, error) {
	var b [8]byte
	if _, err := io.ReadFull(r, b[:]); err != nil {
		return 0, err
	}
	return int(binary.BigEndian.Uint64(b[:])%uint64(sides)) + 1, nil
}

// ValidateExpression checks syntax and dice caps without consuming randomness.
func ValidateExpression(expression string) error {
	_, err := RollExpression(expression, zeroReader{})
	return err
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

// Roll modes for a d20 roll.
const (
	RollNormal       = "normal"
	RollAdvantage    = "advantage"
	RollDisadvantage = "disadvantage"
)

// MaxRollBonus bounds the one-off bonus a player may add to a single d20 roll.
const MaxRollBonus = 20

// RollOptions are a player's choices for one d20 roll: advantage or disadvantage, and a
// one-off bonus or penalty. The zero value is a normal roll.
type RollOptions struct {
	Mode  string `json:"mode"`
	Bonus int    `json:"bonus"`
}

func (o RollOptions) Validate() error {
	switch o.Mode {
	case "", RollNormal, RollAdvantage, RollDisadvantage:
	default:
		return fmt.Errorf("mode must be normal, advantage or disadvantage")
	}
	if o.Bonus < -MaxRollBonus || o.Bonus > MaxRollBonus {
		return fmt.Errorf("bonus must be a whole number from -%d to %d", MaxRollBonus, MaxRollBonus)
	}
	return nil
}

// IsNormal reports a plain 1d20 roll with no bonus.
func (o RollOptions) IsNormal() bool {
	return (o.Mode == "" || o.Mode == RollNormal) && o.Bonus == 0
}

// D20 is the expression rolled: 1d20, or 2d20kh1 with advantage and 2d20kl1 with
// disadvantage, plus the modifier and the bonus.
func (o RollOptions) D20(modifier int) string {
	base := "1d20"
	switch o.Mode {
	case RollAdvantage:
		base = "2d20kh1"
	case RollDisadvantage:
		base = "2d20kl1"
	}
	return withModifier(base, modifier+o.Bonus)
}

// Note describes the options for chat, e.g. "advantage, +2 bonus"; it is empty for a normal roll.
func (o RollOptions) Note() string {
	var parts []string
	if o.Mode == RollAdvantage || o.Mode == RollDisadvantage {
		parts = append(parts, o.Mode)
	}
	if o.Bonus != 0 {
		parts = append(parts, fmt.Sprintf("%+d bonus", o.Bonus))
	}
	return strings.Join(parts, ", ")
}
