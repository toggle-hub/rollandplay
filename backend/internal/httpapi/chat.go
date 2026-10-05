package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"

	"github.com/google/uuid"

	"rollandplay/backend/internal/auth"
)

const (
	// chatWindow is how many of the newest messages the room state carries.
	chatWindow = 200
	// chatPageDefault is how many earlier messages one "load earlier" page returns unless asked otherwise.
	chatPageDefault = 100
)

// visibleChat returns up to limit messages the user may see, oldest first: the newest ones, or
// with before set the ones sent before that message. hasEarlier reports whether older visible
// messages remain. Private messages reach their sender, their recipients and game masters.
func (s *Server) visibleChat(ctx context.Context, roomID, userID string, isDM bool, before string, limit int) ([]json.RawMessage, bool, error) {
	var cursor *string
	if before != "" {
		cursor = &before
	}
	rows, err := s.queryJSON(ctx, `select jsonb_build_object('id',cm.id::text,'room_id',cm.room_id::text,'sender_user_id',cm.sender_user_id::text,'kind',cm.kind,'body',cm.body,'roll',cm.roll,'created_at',cm.created_at,'recipient_user_ids',coalesce((select jsonb_agg(user_id::text) from chat_message_recipients where message_id=cm.id),'[]'::jsonb))
		from chat_messages cm
		where cm.room_id=$1
		  and ($3 or cm.sender_user_id=$2 or not exists(select 1 from chat_message_recipients r where r.message_id=cm.id) or exists(select 1 from chat_message_recipients r where r.message_id=cm.id and r.user_id=$2))
		  and ($4::uuid is null or (cm.created_at, cm.id) < (select b.created_at, b.id from chat_messages b where b.id=$4 and b.room_id=$1))
		order by cm.created_at desc, cm.id desc
		limit $5`, roomID, userID, isDM, cursor, limit+1)
	if err != nil {
		return nil, false, err
	}
	hasEarlier := len(rows) > limit
	if hasEarlier {
		rows = rows[:limit]
	}
	slices.Reverse(rows)
	if rows == nil {
		rows = []json.RawMessage{}
	}
	return rows, hasEarlier, nil
}

// handleRoomChat pages back through the room's chat: GET /api/rooms/{roomID}/chat?before=<message id>&limit=<1-200>
// answers {messages, hasEarlier} with the messages sent before that one, oldest first.
func (s *Server) handleRoomChat(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomMember(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "room membership required")
		return
	}
	before := r.URL.Query().Get("before")
	if before != "" {
		parsed, err := uuid.Parse(before)
		if err != nil {
			WriteError(w, 400, "invalid_cursor", "before must be a message id")
			return
		}
		before = parsed.String()
	}
	limit := chatPageDefault
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > chatWindow {
			WriteError(w, 400, "invalid_limit", "limit must be between 1 and 200")
			return
		}
		limit = n
	}
	messages, hasEarlier, err := s.visibleChat(r.Context(), roomID, u.ID, s.isDM(r.Context(), u.ID, roomID), before, limit)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	WriteJSON(w, 200, map[string]any{"messages": messages, "hasEarlier": hasEarlier})
}
