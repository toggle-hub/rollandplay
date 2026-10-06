package httpapi

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// handleMapRooms lists the rooms the caller runs as game master, so the map editor can put this map on
// one of their tables. Each room says whether this map is already its active map and which map is.
func (s *Server) handleMapRooms(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	mapID := r.PathValue("mapID")
	if _, err := uuid.Parse(mapID); err != nil {
		WriteError(w, 404, "not_found", "map not found")
		return
	}
	var visible bool
	err := s.Pool.QueryRow(r.Context(), `select owner_id=$2 or is_public or exists(select 1 from map_editors where map_id=$1 and user_id=$2) from maps where id=$1`, mapID, u.ID).Scan(&visible)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !visible) {
		WriteError(w, 404, "not_found", "map not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',r.id::text,'name',r.name,'is_active',coalesce(active.map_id=$1::uuid,false),'active_map_name',active.name) from rooms r join room_members mem on mem.room_id=r.id and mem.user_id=$2 and mem.is_dm left join lateral (select rm.map_id,m.name from room_maps rm join maps m on m.id=rm.map_id where rm.room_id=r.id and rm.is_active limit 1) active on true order by r.created_at desc`, mapID, u.ID)
	respondRows(w, rows, err)
}

// structureCreateID returns the id for a new map structure: the client's UUID when it sent one, so the
// editor can keep working with a structure before the server has answered, or a fresh one. Writes a 400
// and returns ok=false when the sent id is not a UUID.
func structureCreateID(w http.ResponseWriter, req map[string]any) (string, bool) {
	raw, present := req["id"]
	if !present || raw == nil {
		return uuid.New().String(), true
	}
	value, isString := raw.(string)
	if !isString {
		WriteError(w, 400, "invalid_id", "id must be a UUID")
		return "", false
	}
	parsed, err := uuid.Parse(value)
	if err != nil {
		WriteError(w, 400, "invalid_id", "id must be a UUID")
		return "", false
	}
	return parsed.String(), true
}

// clearsBackground reports whether a map PATCH asks to remove the background: "background_asset_id"
// sent as null or as an empty string.
func clearsBackground(req map[string]any) bool {
	raw, present := req["background_asset_id"]
	return present && (raw == nil || raw == "")
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
