package ws

import "time"

// PublishSheetRemoved tells a room that a deleted character left the table: each of its tokens is
// removed, and the vision update makes clients reload the room, including members who played it
// and now have no character.
func (h *Hub) PublishSheetRemoved(roomID string, tokenIDs []string) {
	for _, id := range tokenIDs {
		h.publish(roomID, envelope{Type: "token.removed", Body: map[string]any{"room_id": roomID, "token_id": id}})
	}
	h.publish(roomID, envelope{Type: "vision.update", Body: map[string]any{"room_id": roomID, "version": time.Now().UnixNano()}})
}
