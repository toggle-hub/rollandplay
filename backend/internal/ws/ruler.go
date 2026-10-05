package ws

import (
	"encoding/json"

	"rollandplay/backend/internal/game"
)

// rulerMeasure shares the ruler this connection is holding with everyone else at the table.
// The measurer draws and measures it locally, so nothing goes back to the sender. Nothing is stored.
func (c *client) rulerMeasure(msg clientEnvelope) {
	var req struct {
		From game.Point `json:"from"`
		To   game.Point `json:"to"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	c.measuring = true
	c.hub.publish(c.roomID, envelope{Type: "ruler.shown", Body: map[string]any{
		"room_id": c.roomID,
		"conn_id": c.connID,
		"user_id": c.userID,
		"from":    req.From,
		"to":      req.To,
		"meters":  game.MeasureDistanceMeters(req.From, req.To),
	}})
}

// clearRuler takes this connection's shared ruler off the table: on release (ruler.clear) or disconnect.
func (c *client) clearRuler() {
	if !c.measuring {
		return
	}
	c.measuring = false
	c.hub.publish(c.roomID, envelope{Type: "ruler.cleared", Body: map[string]any{"room_id": c.roomID, "conn_id": c.connID}})
}
