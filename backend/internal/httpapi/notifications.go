package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"rollandplay/backend/internal/auth"
	"rollandplay/backend/internal/ws"
)

// blockedBetween is a predicate: a friends row blocks the users bound to a and b.
func blockedBetween(a, b string) string {
	return `exists(select 1 from friends bf where bf.status='blocked' and ((bf.requester_user_id=` + a + ` and bf.addressee_user_id=` + b + `) or (bf.requester_user_id=` + b + ` and bf.addressee_user_id=` + a + `)))`
}

func notificationActor(u auth.User) *ws.NotificationUser {
	return &ws.NotificationUser{ID: u.ID, Username: u.Username, Pronouns: u.Pronouns}
}

// roomInvitationJSON renders room_invitations i for its room's game masters.
const roomInvitationJSON = `jsonb_build_object('id',i.id::text,'room_id',i.room_id::text,'created_at',i.created_at,'invitee',jsonb_build_object('id',iu.id::text,'username',iu.username,'pronouns',iu.pronouns))`

// handleNotifications lists what waits for the caller: incoming friend requests and room invitations.
// Clients reload it whenever GET /api/notifications/ws pushes a notification.
func (s *Server) handleNotifications(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	requests, err := s.queryJSON(r.Context(), friendSelect+` where f.addressee_user_id=$1 and f.status='pending' order by f.created_at desc`, u.ID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	invitations, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',i.id::text,'created_at',i.created_at,'room',jsonb_build_object('id',r.id::text,'name',r.name,'rule_book',jsonb_build_object('id',b.id::text,'name',b.name)),'inviter',jsonb_build_object('id',iu.id::text,'username',iu.username,'pronouns',iu.pronouns)) from room_invitations i join rooms r on r.id=i.room_id join rule_books b on b.id=r.rule_book_id join users iu on iu.id=i.inviter_user_id where i.invitee_user_id=$1 and not `+blockedBetween("i.inviter_user_id", "$1")+` order by i.created_at desc`, u.ID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if requests == nil {
		requests = []json.RawMessage{}
	}
	if invitations == nil {
		invitations = []json.RawMessage{}
	}
	WriteJSON(w, 200, map[string]any{"friend_requests": requests, "room_invitations": invitations})
}

const (
	minCandidateQuery = 2
	maxCandidates     = 8
)

// handleInviteCandidates finds users a game master may invite by username: substring matches,
// prefix matches first. Members, the caller, users without a finished profile and users blocked
// either way are left out; `invited` marks users with a pending invitation to the room.
func (s *Server) handleInviteCandidates(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomDM(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if n := utf8.RuneCountInString(q); n < minCandidateQuery || n > 80 {
		WriteJSON(w, 200, []json.RawMessage{})
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',u.id::text,'username',u.username,'pronouns',u.pronouns,'invited',exists(select 1 from room_invitations i where i.room_id=$1 and i.invitee_user_id=u.id)) from users u where u.profile_complete and u.id<>$2 and strpos(lower(u.username),lower($3))>0 and not exists(select 1 from room_members m where m.room_id=$1 and m.user_id=u.id) and not `+blockedBetween("u.id", "$2")+` order by strpos(lower(u.username),lower($3))=1 desc, length(u.username), u.username limit $4`, roomID, u.ID, q, maxCandidates)
	if rows == nil && err == nil {
		rows = []json.RawMessage{}
	}
	respondRows(w, rows, err)
}

// handleRoomInvitationsList lists the room's pending invitations for its game masters.
func (s *Server) handleRoomInvitationsList(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomDM(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	rows, err := s.queryJSON(r.Context(), `select `+roomInvitationJSON+` from room_invitations i join users iu on iu.id=i.invitee_user_id where i.room_id=$1 order by i.created_at desc`, roomID)
	if rows == nil && err == nil {
		rows = []json.RawMessage{}
	}
	respondRows(w, rows, err)
}

// handleRoomInvitationCreate invites a user to the room by exact username; game masters only.
func (s *Server) handleRoomInvitationCreate(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomDM(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	var req struct {
		Username string `json:"username"`
	}
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	var target ws.NotificationUser
	var member, blocked bool
	err := s.Pool.QueryRow(r.Context(), `select u.id::text, u.username, u.pronouns, exists(select 1 from room_members m where m.room_id=$1 and m.user_id=u.id), `+blockedBetween("u.id", "$2")+` from users u where u.username=$3 and u.profile_complete`, roomID, u.ID, strings.TrimSpace(req.Username)).Scan(&target.ID, &target.Username, &target.Pronouns, &member, &blocked)
	// A block is reported like an unknown user, so it isn't revealed.
	if errors.Is(err, pgx.ErrNoRows) || blocked {
		WriteError(w, 404, "not_found", "no player has that username")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if target.ID == u.ID || member {
		WriteError(w, 409, "already_member", "that player is already at this table")
		return
	}
	var row json.RawMessage
	var roomName string
	err = s.Pool.QueryRow(r.Context(), `with i as (insert into room_invitations(id,room_id,inviter_user_id,invitee_user_id) values($1,$2,$3,$4) on conflict(room_id,invitee_user_id) do nothing returning *) select `+roomInvitationJSON+`, r.name from i join users iu on iu.id=i.invitee_user_id join rooms r on r.id=i.room_id`, uuid.New().String(), roomID, u.ID, target.ID).Scan(&row, &roomName)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 409, "invitation_exists", "that player is already invited")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	s.Notifier.Notify(target.ID, ws.Notification{Kind: ws.RoomInvitationCreated, Actor: notificationActor(u), Room: &ws.NotificationRoom{ID: roomID, Name: roomName}})
	writeRaw(w, 201, row)
}

// handleRoomInvitationAccept joins the invitee to the room as a player, without the invite code or
// password, and answers like POST /api/rooms/join.
func (s *Server) handleRoomInvitationAccept(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("invitationID")
	if _, err := uuid.Parse(id); err != nil {
		WriteError(w, 404, "not_found", "invitation not found")
		return
	}
	var roomID string
	err := s.Pool.QueryRow(r.Context(), `select room_id::text from room_invitations where id=$1 and invitee_user_id=$2`, id, u.ID).Scan(&roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "invitation not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if _, err := s.Pool.Exec(r.Context(), `insert into room_members(id,room_id,user_id,is_dm) values($1,$2,$3,false) on conflict(room_id,user_id) do nothing`, uuid.New().String(), roomID, u.ID); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	s.respondJoined(w, r, u, roomID)
}

// handleRoomInvitationDelete declines an invitation (the invitee) or revokes it (a game master of the
// room); the other side is told.
func (s *Server) handleRoomInvitationDelete(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("invitationID")
	if _, err := uuid.Parse(id); err != nil {
		WriteError(w, 404, "not_found", "invitation not found")
		return
	}
	var room ws.NotificationRoom
	var inviteeID, inviterID string
	err := s.Pool.QueryRow(r.Context(), `delete from room_invitations i using rooms r where r.id=i.room_id and i.id=$1 and (i.invitee_user_id=$2 or exists(select 1 from room_members m where m.room_id=i.room_id and m.user_id=$2 and m.is_dm)) returning r.id::text, r.name, i.invitee_user_id::text, i.inviter_user_id::text`, id, u.ID).Scan(&room.ID, &room.Name, &inviteeID, &inviterID)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "invitation not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if u.ID == inviteeID {
		s.Notifier.Notify(inviterID, ws.Notification{Kind: ws.RoomInvitationRemoved, Actor: notificationActor(u), Room: &room})
	} else {
		s.Notifier.Notify(inviteeID, ws.Notification{Kind: ws.RoomInvitationRemoved, Room: &room})
	}
	w.WriteHeader(204)
}
