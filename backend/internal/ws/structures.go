package ws

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"rollandplay/backend/internal/game"
)

// activeStructuresSQL selects the structures on a room's active map as that room sees them: the saved
// map's structures with the room's moves, hides, open doors and removals applied, plus the ones placed at
// this table. Rows scan with scanStructure; callers append conditions with `and`.
const activeStructuresSQL = `select rm.id::text,ms.id::text,ms.kind,coalesce(rmss.geometry,ms.geometry),ms.blocks_vision,ms.blocks_movement,ms.blocks_attacks,ms.cover_bonus,ms.pass_rules,coalesce(rmss.is_hidden,false),coalesce(rmss.is_open,false) from map_structures ms join room_maps rm on rm.map_id=ms.map_id left join room_map_structure_states rmss on rmss.room_map_id=rm.id and rmss.structure_id=ms.id where rm.room_id=$1 and rm.is_active and (ms.room_map_id is null or ms.room_map_id=rm.id) and not coalesce(rmss.is_removed,false)`

// scanStructure reads one activeStructuresSQL row and the id of the room map it is on.
func scanStructure(row pgx.Row) (game.Structure, string, error) {
	var roomMapID, id, kind string
	var geometry, passRules []byte
	var blocksVision, blocksMovement, blocksAttacks, hidden, open bool
	var cover int
	if err := row.Scan(&roomMapID, &id, &kind, &geometry, &blocksVision, &blocksMovement, &blocksAttacks, &cover, &passRules, &hidden, &open); err != nil {
		return game.Structure{}, "", err
	}
	structure := game.ParseStructure(id, kind, geometry, passRules, blocksVision, blocksMovement, blocksAttacks, cover)
	structure.IsHidden = hidden
	structure.IsOpen = open && kind == "door"
	return structure, roomMapID, nil
}

// LoadActiveStructures lists the structures on the room's active map in draw order.
func LoadActiveStructures(ctx context.Context, pool *pgxpool.Pool, roomID string) ([]game.Structure, error) {
	rows, err := pool.Query(ctx, activeStructuresSQL+` order by ms.z_index, ms.created_at, ms.id`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []game.Structure
	for rows.Next() {
		structure, _, err := scanStructure(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, structure)
	}
	return out, rows.Err()
}

// structureDoor opens or closes a door on the active map for this room only. Only game masters
// open and close doors; an open door stops blocking movement, sight and attacks.
func (c *client) structureDoor(msg clientEnvelope) {
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "DM required")
		return
	}
	var req struct {
		StructureID string `json:"structureId"`
		IsOpen      bool   `json:"isOpen"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	ctx := context.Background()
	structure, roomMapID, err := c.hub.loadStructure(ctx, c.roomID, req.StructureID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "structure not found")
		return
	}
	if structure.Kind != "door" {
		c.error(msg.RequestID, "not_a_door", "only doors open and close")
		return
	}
	_, err = c.hub.pool.Exec(ctx, `insert into room_map_structure_states(room_map_id,structure_id,is_open) values($1,$2,$3) on conflict(room_map_id,structure_id) do update set is_open=excluded.is_open,updated_at=now()`, roomMapID, req.StructureID, req.IsOpen)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	c.hub.publish(c.roomID, envelope{Type: "structure.updated", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "structure_id": req.StructureID, "is_open": req.IsOpen}})
	c.hub.publish(c.roomID, envelope{Type: "vision.update", RequestID: nil, Body: map[string]any{"room_id": c.roomID, "version": time.Now().UnixNano()}})
}

// structureRestore puts back a structure removed from the active map at this table, which is how
// the game master's undo reverses structure.remove.
func (c *client) structureRestore(msg clientEnvelope) {
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "DM required")
		return
	}
	var req struct {
		StructureID string `json:"structureId"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	restored, err := c.hub.pool.Exec(context.Background(), `update room_map_structure_states rmss set is_removed=false,updated_at=now() from room_maps rm, map_structures ms where rm.room_id=$1 and rm.is_active and rmss.room_map_id=rm.id and rmss.structure_id=$2 and rmss.is_removed and ms.id=rmss.structure_id and ms.map_id=rm.map_id and (ms.room_map_id is null or ms.room_map_id=rm.id)`, c.roomID, req.StructureID)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	if restored.RowsAffected() == 0 {
		c.error(msg.RequestID, "not_found", "no removed structure to restore")
		return
	}
	c.hub.bump(c.roomID)
	c.hub.publish(c.roomID, envelope{Type: "structure.updated", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "structure_id": req.StructureID, "is_removed": false}})
	c.hub.publish(c.roomID, envelope{Type: "vision.update", RequestID: nil, Body: map[string]any{"room_id": c.roomID, "version": time.Now().UnixNano()}})
}

// PublishStructuresChanged tells a room to reload its structures after its saved map changed over HTTP.
func (h *Hub) PublishStructuresChanged(roomID, mapID string) {
	h.publish(roomID, envelope{Type: "structure.updated", Body: map[string]any{"room_id": roomID, "map_id": mapID}})
	h.publish(roomID, envelope{Type: "vision.update", Body: map[string]any{"room_id": roomID, "version": time.Now().UnixNano()}})
}
