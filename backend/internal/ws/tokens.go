package ws

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"rollandplay/backend/internal/game"
)

// TokenSelectSQL selects room tokens in the column order ScanToken reads; callers append the where clause.
const TokenSelectSQL = `select rt.id::text,coalesce(rt.owner_user_id::text,''),rt.name,rt.x_m::float8,rt.y_m::float8,rt.rotation_deg::float8,rt.size_m::float8,rt.vision_range_m::float8,rt.is_hidden,rt.attributes,coalesce(rt.sheet_id::text,''),coalesce(s.user_id::text,''),coalesce(s.data,rt.attributes),coalesce(rt.image_asset_id::text,''),coalesce((select array_agg(m.user_id::text order by m.user_id) from room_token_movers m where m.token_id=rt.id),'{}'::text[]) from room_tokens rt join room_maps rm on rm.id=rt.room_map_id left join sheets s on s.id=rt.sheet_id`

// ScanToken reads one row selected with TokenSelectSQL.
func ScanToken(row pgx.Row) (game.Token, error) {
	var t game.Token
	var attrs, stats []byte
	if err := row.Scan(&t.ID, &t.OwnerUserID, &t.Name, &t.X, &t.Y, &t.RotationDeg, &t.SizeM, &t.VisionRangeM, &t.IsHidden, &attrs, &t.SheetID, &t.SheetOwnerUserID, &stats, &t.ImageAssetID, &t.MoverUserIDs); err != nil {
		return t, err
	}
	// Separate decodes keep Attributes and Stats unaliased for sheetless tokens.
	_ = json.Unmarshal(attrs, &t.Attributes)
	_ = json.Unmarshal(stats, &t.Stats)
	return t, nil
}

// LoadActiveTokens lists the tokens on the room's active map.
func LoadActiveTokens(ctx context.Context, pool *pgxpool.Pool, roomID string) ([]game.Token, error) {
	rows, err := pool.Query(ctx, TokenSelectSQL+` where rm.room_id=$1 and rm.is_active`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []game.Token
	for rows.Next() {
		t, err := ScanToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
