package game

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

type DieRoll struct {
	Count  int   `json:"count"`
	Sides  int   `json:"sides"`
	Values []int `json:"values"`
}
type RollResult struct {
	Expression string    `json:"expression"`
	Dice       []DieRoll `json:"dice"`
	Modifier   int       `json:"modifier"`
	Total      int       `json:"total"`
}

var diceExprRE = regexp.MustCompile(`^[+-]?([0-9]*d[0-9]+|[0-9]+)([+-]([0-9]*d[0-9]+|[0-9]+))*$`)

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
	parts := regexp.MustCompile(`[+-][^+-]+`).FindAllString(expr, -1)
	for _, p := range parts {
		sign := 1
		if p[0] == '-' {
			sign = -1
		}
		term := p[1:]
		if strings.Contains(term, "d") {
			bits := strings.Split(term, "d")
			count := 1
			if bits[0] != "" {
				v, err := strconv.Atoi(bits[0])
				if err != nil {
					return res, err
				}
				count = v
			}
			sides, err := strconv.Atoi(bits[1])
			if err != nil {
				return res, err
			}
			if count < 1 || count > 100 || sides < 1 || sides > 1000 {
				return res, fmt.Errorf("dice cap exceeded")
			}
			dr := DieRoll{Count: count, Sides: sides}
			for i := 0; i < count; i++ {
				v, err := rollOne(rng, sides)
				if err != nil {
					return res, err
				}
				dr.Values = append(dr.Values, v)
				res.Total += sign * v
			}
			res.Dice = append(res.Dice, dr)
		} else {
			v, err := strconv.Atoi(term)
			if err != nil {
				return res, err
			}
			res.Modifier += sign * v
			res.Total += sign * v
		}
	}
	return res, nil
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
