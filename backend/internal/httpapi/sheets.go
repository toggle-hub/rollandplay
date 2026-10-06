package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// handleSheetDelete deletes the caller's own character. Its tokens leave every room map, and room
// members who played it stay in their rooms without a character; each affected room reloads.
// Other users' sheets, public or not, are 404.
func (s *Server) handleSheetDelete(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	sheetID := r.PathValue("sheetID")
	if _, err := uuid.Parse(sheetID); err != nil {
		WriteError(w, 404, "not_found", "sheet not found")
		return
	}
	ctx := r.Context()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	// Lock the sheet so no token or member assignment can pick it up before it is gone.
	var locked string
	err = tx.QueryRow(ctx, `select id::text from sheets where id=$1 and user_id=$2 for update`, sheetID, u.ID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "sheet not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	removed := map[string][]string{}
	rows, err := tx.Query(ctx, `delete from room_tokens rt using room_maps rm where rm.id=rt.room_map_id and rt.sheet_id=$1 returning rm.room_id::text, rt.id::text`, sheetID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	for rows.Next() {
		var roomID, tokenID string
		if err := rows.Scan(&roomID, &tokenID); err != nil {
			rows.Close()
			WriteError(w, 500, "db", err.Error())
			return
		}
		removed[roomID] = append(removed[roomID], tokenID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	// Member assignments clear through the room_members.sheet_id foreign key (on delete set null).
	rows, err = tx.Query(ctx, `select distinct room_id::text from room_members where sheet_id=$1`, sheetID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	for rows.Next() {
		var roomID string
		if err := rows.Scan(&roomID); err != nil {
			rows.Close()
			WriteError(w, 500, "db", err.Error())
			return
		}
		if _, seen := removed[roomID]; !seen {
			removed[roomID] = nil
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if _, err := tx.Exec(ctx, `delete from sheets where id=$1`, sheetID); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	for roomID, tokenIDs := range removed {
		s.bumpRoom(ctx, roomID)
		s.Hub.PublishSheetRemoved(roomID, tokenIDs)
	}
	w.WriteHeader(204)
}

// refreshSheetTokens tells every room holding one of the sheet's tokens to reload it. The sheet
// write already succeeded, so a failed lookup only skips the live refresh.
func (s *Server) refreshSheetTokens(ctx context.Context, sheetID string) {
	rows, err := s.Pool.Query(ctx, `select rt.id::text, rm.room_id::text from room_tokens rt join room_maps rm on rm.id=rt.room_map_id where rt.sheet_id=$1`, sheetID)
	if err != nil {
		return
	}
	var tokens [][2]string
	for rows.Next() {
		var tokenID, roomID string
		if rows.Scan(&tokenID, &roomID) == nil {
			tokens = append(tokens, [2]string{tokenID, roomID})
		}
	}
	rows.Close()
	for _, t := range tokens {
		s.bumpRoom(ctx, t[1])
		s.Hub.PublishTokenUpdated(t[1], t[0])
	}
}
