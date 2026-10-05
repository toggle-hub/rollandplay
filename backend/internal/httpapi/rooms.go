package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"rollandplay/backend/internal/ws"
)

// handleRoomDelete deletes a room for good; only the game master who created it may. Its members,
// map placements, tokens, structures placed during play, checks, chat and pending invitations go
// with it (every table referencing rooms cascades). Maps, characters and rule books stay in their
// owners' libraries. Connected room clients get `room.deleted` and are disconnected, and pending
// invitees are told so their notifications reload.
func (s *Server) handleRoomDelete(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	isOwner, isMember, err := s.roomRole(r.Context(), roomID, u.ID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !isOwner && !isMember) {
		WriteError(w, 404, "not_found", "room not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if !isOwner {
		WriteError(w, 403, "owner_required", "only the game master who created this room can delete it")
		return
	}
	// The select reads the invitations as they were before the delete cascaded to them.
	var room ws.NotificationRoom
	var invitees []string
	err = s.Pool.QueryRow(r.Context(), `with gone as (delete from rooms where id=$1 and owner_id=$2 returning id, name) select g.id::text, g.name, coalesce(array_agg(i.invitee_user_id::text) filter (where i.invitee_user_id is not null), '{}') from gone g left join room_invitations i on i.room_id=g.id group by g.id, g.name`, roomID, u.ID).Scan(&room.ID, &room.Name, &invitees)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "room not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	s.Hub.PublishRoomDeleted(roomID)
	for _, invitee := range invitees {
		s.Notifier.Notify(invitee, ws.Notification{Kind: ws.RoomInvitationRemoved, Room: &room})
	}
	w.WriteHeader(204)
}

// handleRoomLeave takes the caller out of a room they joined. Tokens of their own characters leave
// the room's maps, and moves granted to them on the room's tokens end. The room's creator deletes
// the room instead. Room clients get `member.left`; the leaver's connections are then closed.
func (s *Server) handleRoomLeave(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	isOwner, isMember, err := s.roomRole(r.Context(), roomID, u.ID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !isMember) {
		WriteError(w, 404, "not_found", "you are not at this table")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if isOwner {
		WriteError(w, 409, "owner_cannot_leave", "you created this room; delete it instead of leaving")
		return
	}
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	var isDM bool
	err = tx.QueryRow(r.Context(), `delete from room_members where room_id=$1 and user_id=$2 returning is_dm`, roomID, u.ID).Scan(&isDM)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "you are not at this table")
		return
	}
	// A player's tokens are their characters; a game master's tokens are the table's and stay.
	if err == nil {
		_, err = tx.Exec(r.Context(), `delete from room_tokens rt using room_maps rm where rm.id=rt.room_map_id and rm.room_id=$1 and (rt.sheet_id in (select id from sheets where user_id=$2) or (rt.owner_user_id=$2 and not $3))`, roomID, u.ID, isDM)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `delete from room_token_movers mv using room_tokens rt, room_maps rm where mv.token_id=rt.id and rm.id=rt.room_map_id and rm.room_id=$1 and mv.user_id=$2`, roomID, u.ID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	s.bumpRoom(context.Background(), roomID)
	s.Hub.PublishMemberLeft(roomID, u.ID)
	w.WriteHeader(204)
}

// roomRole reports whether the user created the room and whether they are a member of it;
// pgx.ErrNoRows means there is no such room.
func (s *Server) roomRole(ctx context.Context, roomID, userID string) (isOwner, isMember bool, err error) {
	if _, err := uuid.Parse(roomID); err != nil {
		return false, false, pgx.ErrNoRows
	}
	err = s.Pool.QueryRow(ctx, `select r.owner_id=$2, exists(select 1 from room_members m where m.room_id=r.id and m.user_id=$2) from rooms r where r.id=$1`, roomID, userID).Scan(&isOwner, &isMember)
	return isOwner, isMember, err
}
