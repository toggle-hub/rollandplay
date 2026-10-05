package ws

import (
	"context"
	"crypto/rand"
	"encoding/json"

	"github.com/google/uuid"

	"rollandplay/backend/internal/game"
)

// chatSend posts a table message. The text stays the message body; an optional dice roll is
// rolled on the server and stored beside it. Game masters may send privately to any member of
// the room, players only to the room's game masters.
func (c *client) chatSend(msg clientEnvelope) {
	var req struct {
		Text             string   `json:"text"`
		RecipientUserIDs []string `json:"recipientUserIds"`
		RollExpression   string   `json:"rollExpression"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	ctx := context.Background()
	recipients, ok := canonicalUserIDs(req.RecipientUserIDs)
	if ok && len(recipients) > 0 {
		var err error
		ok, err = c.hub.privateRecipientsAllowed(ctx, c.roomID, recipients, !c.isDM)
		if err != nil {
			c.error(msg.RequestID, "db", err.Error())
			return
		}
	}
	if !ok {
		if c.isDM {
			c.error(msg.RequestID, "invalid_recipients", "Private messages can only go to people at this table.")
		} else {
			c.error(msg.RequestID, "forbidden", "Players can send private messages only to the game master.")
		}
		return
	}
	kind := "chat"
	if len(recipients) > 0 {
		kind = "dm"
	}
	var roll any
	if req.RollExpression != "" {
		rr, err := game.RollExpression(req.RollExpression, rand.Reader)
		if err != nil {
			c.error(msg.RequestID, "bad_roll", err.Error())
			return
		}
		kind = "roll"
		roll = rr
	}
	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	message, err := insertChat(ctx, tx, c.roomID, c.userID, kind, req.Text, roll, recipients)
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	evType := "chat.message"
	if kind == "roll" {
		evType = "roll.result"
	}
	c.hub.publish(c.roomID, envelope{Type: evType, RequestID: &msg.RequestID, Body: message})
}

// canonicalUserIDs dedupes user IDs in their canonical form; ok is false when one is not a UUID.
func canonicalUserIDs(ids []string) ([]string, bool) {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		parsed, err := uuid.Parse(id)
		if err != nil {
			return nil, false
		}
		out = append(out, parsed.String())
	}
	return uniqueStrings(out), true
}

// privateRecipientsAllowed reports whether every recipient is a member of the room and, when
// gmOnly is set, one of its game masters.
func (h *Hub) privateRecipientsAllowed(ctx context.Context, roomID string, recipients []string, gmOnly bool) (bool, error) {
	var n int
	err := h.pool.QueryRow(ctx, `select count(*) from room_members where room_id=$1 and user_id=any($2::uuid[]) and (is_dm or not $3)`, roomID, recipients, gmOnly).Scan(&n)
	return n == len(recipients), err
}
