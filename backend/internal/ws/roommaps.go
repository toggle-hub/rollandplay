package ws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MapSpec sizes a blank map started from the table. An empty Name becomes "<room name> map".
type MapSpec struct {
	Name      string
	WidthM    float64
	HeightM   float64
	GridSizeM float64
}

// DefaultMapSpec matches the 30 × 30 m board the room canvas draws when no map is active,
// so a structure placed on that board lands where the game master clicked.
var DefaultMapSpec = MapSpec{WidthM: 30, HeightM: 30, GridSizeM: 1}

const maxMapSideM = 1000

// ErrInvalidMapSpec reports map dimensions a blank map cannot use.
var ErrInvalidMapSpec = errors.New("invalid map size")

func (s MapSpec) validate() error {
	for _, v := range []float64{s.WidthM, s.HeightM, s.GridSizeM} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
			return fmt.Errorf("%w: width, height and grid size must be positive numbers", ErrInvalidMapSpec)
		}
	}
	if s.WidthM > maxMapSideM || s.HeightM > maxMapSideM {
		return fmt.Errorf("%w: width and height must be at most %d meters", ErrInvalidMapSpec, maxMapSideM)
	}
	if s.GridSizeM > math.Min(s.WidthM, s.HeightM) {
		return fmt.Errorf("%w: grid size must fit inside the map", ErrInvalidMapSpec)
	}
	return nil
}

const mapJSON = `jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'width_m',width_m,'height_m',height_m,'grid_size_m',grid_size_m,'background_asset_id',background_asset_id::text)`

// createActiveRoomMap stores a blank map in ownerID's library, attaches it to the room and makes
// it the room's only active map.
func createActiveRoomMap(ctx context.Context, tx pgx.Tx, roomID, ownerID string, spec MapSpec) (mapID, roomMapID string, row json.RawMessage, err error) {
	if err = spec.validate(); err != nil {
		return "", "", nil, err
	}
	name := spec.Name
	if name == "" {
		if err = tx.QueryRow(ctx, `select name || ' map' from rooms where id=$1`, roomID).Scan(&name); err != nil {
			return "", "", nil, err
		}
	}
	mapID, roomMapID = uuid.New().String(), uuid.New().String()
	if err = tx.QueryRow(ctx, `insert into maps(id,owner_id,name,width_m,height_m,grid_size_m) values($1,$2,$3,$4,$5,$6) returning `+mapJSON, mapID, ownerID, name, spec.WidthM, spec.HeightM, spec.GridSizeM).Scan(&row); err != nil {
		return "", "", nil, err
	}
	if _, err = tx.Exec(ctx, `update room_maps set is_active=false where room_id=$1`, roomID); err != nil {
		return "", "", nil, err
	}
	if _, err = tx.Exec(ctx, `insert into room_maps(id,room_id,map_id,is_active) values($1,$2,$3,true)`, roomMapID, roomID, mapID); err != nil {
		return "", "", nil, err
	}
	return mapID, roomMapID, row, nil
}

// CreateBlankRoomMap starts a blank map for the room, makes it active and tells the room.
func (h *Hub) CreateBlankRoomMap(ctx context.Context, roomID, ownerID string, spec MapSpec) (json.RawMessage, error) {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	mapID, _, row, err := createActiveRoomMap(ctx, tx, roomID, ownerID, spec)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	h.bump(roomID)
	h.PublishMapActivated(roomID, mapID)
	return row, nil
}

// PublishMapActivated tells room clients to reload because the active map changed.
func (h *Hub) PublishMapActivated(roomID, mapID string) {
	h.publish(roomID, envelope{Type: "map.activated", Body: map[string]any{"room_id": roomID, "map_id": mapID}})
}
