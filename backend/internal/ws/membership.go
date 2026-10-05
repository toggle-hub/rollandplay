package ws

import (
	"time"

	"github.com/gorilla/websocket"
)

// PublishMemberLeft tells room clients to reload after someone leaves the room over HTTP. The
// leaver's own connections to the room receive it and are then closed.
func (h *Hub) PublishMemberLeft(roomID, userID string) {
	h.publish(roomID, envelope{Type: "member.left", Body: map[string]any{"room_id": roomID, "user_id": userID}})
}

// PublishRoomDeleted tells the room's clients that it was deleted; every connection to it is then closed.
func (h *Hub) PublishRoomDeleted(roomID string) {
	h.publish(roomID, envelope{Type: "room.deleted", Body: map[string]any{"room_id": roomID}})
}

// endsConnection reports whether ev, just written to c, takes c out of its room: the room was
// deleted, or c's user left it. The write loop then says goodbye and closes the connection.
func (c *client) endsConnection(ev envelope) bool {
	switch ev.Type {
	case "room.deleted":
		return true
	case "member.left":
		body, _ := ev.Body.(map[string]any)
		return body["user_id"] == c.userID
	}
	return false
}

// sayGoodbye sends a normal close frame, so the browser sees a deliberate close rather than a dropped connection.
func (c *client) sayGoodbye() {
	_ = c.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "no longer in this room"), time.Now().Add(time.Second))
}
