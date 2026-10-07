package ws

import (
	"context"
	"fmt"
	"math"
	"strconv"

	"github.com/jackc/pgx/v5"

	"rollandplay/backend/internal/game"
)

// maxTurnActions bounds the actions one turn may allow.
const maxTurnActions = 10

// turnSpend is what one request takes from the running fight's current turn.
type turnSpend struct {
	tokens []game.Token       // tokens the request moves or acts with
	action bool               // the request takes the acting token's action
	walked map[string]float64 // meters each moved token walks, by token ID
}

// spendTurn enforces the running fight's turn rules for a player's request inside tx and records
// what it spends. Game masters, tokens outside the fight, and rooms without a fight are never
// limited. It replies with an error and returns false when the request breaks a rule.
func (c *client) spendTurn(ctx context.Context, tx pgx.Tx, requestID string, spend turnSpend) bool {
	if c.isDM {
		return true
	}
	combat, err := LoadCombat(ctx, tx, c.roomID, true)
	if err != nil {
		c.error(requestID, "db", err.Error())
		return false
	}
	if combat == nil {
		return true
	}
	cur := combat.Current()
	var acting *game.Token
	for i, t := range spend.tokens {
		if !combat.hasToken(t.ID) {
			continue
		}
		if cur == nil || cur.TokenID != t.ID {
			c.error(requestID, "not_your_turn", "It is not "+t.Name+"'s turn.")
			return false
		}
		acting = &spend.tokens[i]
	}
	if acting == nil {
		return true
	}
	if spend.action {
		if combat.ActionsUsed >= combat.ActionsAllowed {
			c.error(requestID, "no_action_left", acting.Name+" has already used its action this turn.")
			return false
		}
		combat.ActionsUsed++
	}
	if m := spend.walked[acting.ID]; m > 0 {
		speed, _ := acting.Stats["speed_m"].(float64)
		if speed > 0 && combat.MovedM+m > speed+1e-6 {
			c.error(requestID, "too_far", fmt.Sprintf("%s can move %s m more this turn.", acting.Name, formatMeters(math.Max(0, speed-combat.MovedM))))
			return false
		}
		combat.MovedM += m
	}
	if err := saveTurnUsage(ctx, tx, c.roomID, combat); err != nil {
		c.error(requestID, "db", err.Error())
		return false
	}
	return true
}

// formatMeters writes meters to one decimal place, without a trailing ".0".
func formatMeters(v float64) string {
	return strconv.FormatFloat(math.Round(v*10)/10, 'f', -1, 64)
}
