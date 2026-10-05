package ws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"rollandplay/backend/internal/game"
)

// maxHealthChange caps one damage or heal amount, like the hit point limit of a token patch.
const maxHealthChange = 1000000

// tokenHealth lets the game master damage or heal a token without a roll, by the same rules as
// an action. Body: {tokenId, damage?, heal?} with exactly one amount from 1 to 1000000.
func (c *client) tokenHealth(msg clientEnvelope) {
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "only the game master can change hit points")
		return
	}
	var req struct {
		TokenID string `json:"tokenId"`
		Damage  int    `json:"damage"`
		Heal    int    `json:"heal"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if req.Damage < 0 || req.Heal < 0 || (req.Damage > 0) == (req.Heal > 0) || max(req.Damage, req.Heal) > maxHealthChange {
		c.error(msg.RequestID, "invalid_amount", "enter an amount from 1 to 1000000 to damage or heal")
		return
	}
	ctx := context.Background()
	token, err := c.hub.loadToken(ctx, c.roomID, req.TokenID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "token not found")
		return
	}
	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	key := tokenStatsKey(token)
	stats, err := beginStats(ctx, tx, []statsKey{key})
	if err != nil {
		c.lockError(msg.RequestID, err)
		return
	}
	patch, err := game.AdjustHealth(stats.target(token), req.Damage, req.Heal)
	switch {
	case errors.Is(err, game.ErrNoHealth):
		c.error(msg.RequestID, "no_health", "set this token's current HP first")
		return
	case errors.Is(err, game.ErrDeadTarget):
		c.error(msg.RequestID, "dead", "the dead can't be healed; lower their failed death saves first")
		return
	}
	stats.apply(key, patch)
	if err = stats.flush(ctx, tx); err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	c.hub.publish(c.roomID, envelope{Type: "token.updated", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "token_id": token.ID}})
}

// tokenRest gives tokens a long rest (see game.LongRest) and tells the table in chat. Body:
// {tokenIds} for chosen tokens, or {party: true} for every player's token on the active map.
func (c *client) tokenRest(msg clientEnvelope) {
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "only the game master can call a rest")
		return
	}
	var req struct {
		TokenIDs []string `json:"tokenIds"`
		Party    bool     `json:"party"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	ctx := context.Background()
	tokens, err := LoadActiveTokens(ctx, c.hub.pool, c.roomID)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	var chosen []game.Token
	if req.Party {
		gameMasters, err := RoomGameMasters(ctx, c.hub.pool, c.roomID)
		if err != nil {
			c.error(msg.RequestID, "db", err.Error())
			return
		}
		for _, t := range tokens {
			if t.Player(gameMasters) != "" {
				chosen = append(chosen, t)
			}
		}
		if len(chosen) == 0 {
			c.error(msg.RequestID, "no_party", "no player characters are on the map")
			return
		}
	} else {
		ids := uniqueStrings(req.TokenIDs)
		for _, t := range tokens {
			if slices.Contains(ids, t.ID) {
				chosen = append(chosen, t)
			}
		}
		if len(ids) == 0 || len(chosen) != len(ids) {
			c.error(msg.RequestID, "not_found", "token not found")
			return
		}
	}
	keys := make([]statsKey, 0, len(chosen))
	for _, t := range chosen {
		keys = append(keys, tokenStatsKey(t))
	}
	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	stats, err := beginStats(ctx, tx, keys)
	if err != nil {
		c.lockError(msg.RequestID, err)
		return
	}
	// Two tokens on one sheet rest once. Hidden tokens rest without being named to players.
	var rested, dead []string
	restedKeys := map[statsKey]bool{}
	for _, t := range chosen {
		key := tokenStatsKey(t)
		if game.IsDead(stats.current[key]) {
			if !t.IsHidden {
				dead = append(dead, t.Name)
			}
			continue
		}
		if !restedKeys[key] {
			stats.apply(key, game.LongRest(stats.target(t)))
			restedKeys[key] = true
		}
		if !t.IsHidden {
			rested = append(rested, t.Name)
		}
	}
	if err := stats.flush(ctx, tx); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	var lines []string
	if len(rested) > 0 {
		lines = append(lines, fmt.Sprintf("Long rest for %s: hit points, death saves and limited uses are restored.", strings.Join(rested, ", ")))
	}
	if len(dead) > 0 {
		lines = append(lines, fmt.Sprintf("%s can't rest: dead.", strings.Join(dead, ", ")))
	}
	var announcement map[string]any
	if len(lines) > 0 {
		if announcement, err = insertChat(ctx, tx, c.roomID, c.userID, "system", strings.Join(lines, " "), nil, []string{}); err != nil {
			c.error(msg.RequestID, "db", err.Error())
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	if announcement != nil {
		c.hub.publish(c.roomID, envelope{Type: "chat.message", RequestID: &msg.RequestID, Body: announcement})
	}
	ids := make([]string, 0, len(chosen))
	for _, t := range chosen {
		ids = append(ids, t.ID)
	}
	c.hub.publish(c.roomID, envelope{Type: "token.updated", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "token_ids": ids}})
}
