package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"rollandplay/backend/internal/auth"
)

// handleRoomMapsList lists the maps a room has used, for its game masters' map picker: how many tokens wait
// on each, whether the caller may edit the saved map, and the structure changes made at this table that
// are not saved to the map yet.
func (s *Server) handleRoomMapsList(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomDM(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',rm.id::text,'map_id',m.id::text,'name',m.name,'is_active',rm.is_active,
		'token_count',(select count(*) from room_tokens rt where rt.room_map_id=rm.id),
		'can_edit',m.owner_id=$2 or exists(select 1 from map_editors me where me.map_id=m.id and me.user_id=$2),
		'table_changes',jsonb_build_object(
			'added',(select count(*) from map_structures ms where ms.room_map_id=rm.id and not exists(select 1 from room_map_structure_states st where st.room_map_id=rm.id and st.structure_id=ms.id and st.is_removed)),
			'moved',(select count(*) from room_map_structure_states st join map_structures ms on ms.id=st.structure_id where st.room_map_id=rm.id and ms.room_map_id is null and not st.is_removed and st.geometry is not null and st.geometry<>ms.geometry),
			'removed',(select count(*) from room_map_structure_states st join map_structures ms on ms.id=st.structure_id where st.room_map_id=rm.id and ms.room_map_id is null and st.is_removed)))
		from room_maps rm join maps m on m.id=rm.map_id where rm.room_id=$1 order by rm.is_active desc, m.name`, roomID, u.ID)
	respondRows(w, rows, err)
}

// handleRoomMapSave writes the structures a game master added, moved or removed at the table into the
// saved map, all or nothing, so the map editor and every room using the map get them. Hidden structures
// and open doors stay a matter of this table.
func (s *Server) handleRoomMapSave(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	roomID, roomMapID := r.PathValue("roomID"), r.PathValue("roomMapID")
	if err := auth.RequireRoomDM(ctx, u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var mapID string
	err = tx.QueryRow(ctx, `select map_id::text from room_maps where id::text=$1 and room_id=$2`, roomMapID, roomID).Scan(&mapID)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "room map not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if err := auth.CanEditMap(ctx, u.ID, mapID); errors.Is(err, auth.ErrForbidden) {
		WriteError(w, 403, "map_edit_forbidden", "Only the map's owner or its editors can save table changes to it.")
		return
	} else if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	// Saves of the same map, from this room or another, run one after the other.
	if _, err := tx.Exec(ctx, `select 1 from maps where id=$1 for update`, mapID); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	var counts struct{ added, moved, removed int64 }
	steps := []struct {
		sql   string
		args  []any
		count *int64
	}{
		// Placed at the table and removed again: nothing to keep.
		{`delete from map_structures ms using room_map_structure_states st where ms.room_map_id=$1 and st.room_map_id=$1 and st.structure_id=ms.id and st.is_removed`, []any{roomMapID}, nil},
		{`delete from map_structures ms using room_map_structure_states st where st.room_map_id=$1 and st.structure_id=ms.id and st.is_removed and ms.map_id=$2 and ms.room_map_id is null`, []any{roomMapID, mapID}, &counts.removed},
		{`update map_structures ms set geometry=st.geometry from room_map_structure_states st where st.room_map_id=$1 and st.structure_id=ms.id and ms.map_id=$2 and ms.room_map_id is null and st.geometry is not null and st.geometry<>ms.geometry`, []any{roomMapID, mapID}, &counts.moved},
		{`update map_structures ms set room_map_id=null,geometry=coalesce((select st.geometry from room_map_structure_states st where st.room_map_id=$1 and st.structure_id=ms.id),ms.geometry) where ms.room_map_id=$1 and ms.map_id=$2`, []any{roomMapID, mapID}, &counts.added},
		// The saved map now matches the table, so the room's moves are no longer overrides.
		{`update room_map_structure_states set geometry=null where room_map_id=$1 and geometry is not null`, []any{roomMapID}, nil},
		{`delete from room_map_structure_states where room_map_id=$1 and geometry is null and not is_hidden and not is_removed and not is_open`, []any{roomMapID}, nil},
		{`update maps set updated_at=now() where id=$1`, []any{mapID}, nil},
	}
	for _, step := range steps {
		tag, err := tx.Exec(ctx, step.sql, step.args...)
		if err != nil {
			WriteError(w, 500, "db", err.Error())
			return
		}
		if step.count != nil {
			*step.count = tag.RowsAffected()
		}
	}
	if err := tx.Commit(ctx); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	WriteJSON(w, 200, map[string]any{"map_id": mapID, "added": counts.added, "moved": counts.moved, "removed": counts.removed})
	s.publishMapStructuresChanged(context.Background(), mapID)
}

// publishMapStructuresChanged bumps every room using the map and tells the ones playing on it to reload.
func (s *Server) publishMapStructuresChanged(ctx context.Context, mapID string) {
	s.bumpMapRooms(ctx, mapID)
	rows, err := s.Pool.Query(ctx, `select room_id::text from room_maps where map_id=$1 and is_active`, mapID)
	if err != nil {
		return
	}
	var roomIDs []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			roomIDs = append(roomIDs, id)
		}
	}
	rows.Close()
	for _, id := range roomIDs {
		s.Hub.PublishStructuresChanged(id, mapID)
	}
}
