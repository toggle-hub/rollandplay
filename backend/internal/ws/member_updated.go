package ws

// PublishMemberUpdated tells room clients to reload the member list after a member's assigned
// character changes over HTTP, so prompts and the member list use the new character.
func (h *Hub) PublishMemberUpdated(roomID, userID string) {
	h.publish(roomID, envelope{Type: "member.updated", Body: map[string]any{"room_id": roomID, "user_id": userID}})
}
