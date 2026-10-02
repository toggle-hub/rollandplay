package ws

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
	"go.uber.org/zap"

	"rollandplay/backend/internal/auth"
	"rollandplay/backend/internal/game"
)

type Hub struct {
	pool     *pgxpool.Pool
	redis    *redis.Client
	mu       sync.Mutex
	clients  map[*client]bool
	upgrader websocket.Upgrader
	logger   *zap.Logger
}
type client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan envelope
	roomID string
	userID string
	isDM   bool
}
type envelope struct {
	Type      string  `json:"type"`
	RequestID *string `json:"requestId"`
	Body      any     `json:"body"`
}
type clientEnvelope struct {
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	Body      json.RawMessage `json:"body"`
}

func NewHub(pool *pgxpool.Pool, rdb *redis.Client) *Hub {
	return NewHubWithLogger(pool, rdb, zap.NewNop())
}

func NewHubWithLogger(pool *pgxpool.Pool, rdb *redis.Client, logger *zap.Logger) *Hub {
	if logger == nil {
		logger = zap.NewNop()
	}
	h := &Hub{pool: pool, redis: rdb, logger: logger, clients: map[*client]bool{}, upgrader: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}}
	if _, err := otel.Meter("rollandplay/backend/internal/ws").Int64ObservableGauge("rollandplay.websocket.connections",
		metric.WithDescription("Open websocket connections on this backend instance."),
		metric.WithUnit("{connection}"),
		metric.WithInt64Callback(func(_ context.Context, o metric.Int64Observer) error {
			h.mu.Lock()
			n := len(h.clients)
			h.mu.Unlock()
			o.Observe(int64(n))
			return nil
		}),
	); err != nil {
		logger.Warn("websocket connections metric unavailable", zap.Error(err))
	}
	if rdb != nil {
		go h.subscribe(context.Background())
	}
	return h
}

func (h *Hub) Handle(w http.ResponseWriter, r *http.Request) {
	u, _, err := auth.AuthenticateRequest(r)
	if err != nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomMember(r.Context(), u.ID, roomID); err != nil {
		h.logger.Warn("websocket forbidden", zap.String("room_id", roomID), zap.String("user_id", u.ID))
		http.Error(w, "forbidden", 403)
		return
	}
	isDM := h.isDM(r.Context(), u.ID, roomID)
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Warn("websocket upgrade failed", zap.String("room_id", roomID), zap.String("user_id", u.ID), zap.Error(err))
		return
	}
	c := &client{hub: h, conn: conn, send: make(chan envelope, 32), roomID: roomID, userID: u.ID, isDM: isDM}
	h.mu.Lock()
	h.clients[c] = true
	h.mu.Unlock()
	h.logger.Info("websocket connected", zap.String("room_id", roomID), zap.String("user_id", u.ID), zap.Bool("is_dm", isDM))
	go c.writeLoop()
	go c.readLoop()
	c.send <- envelope{Type: "state.snapshot", Body: h.snapshot(r.Context(), roomID, u.ID)}
}

func (h *Hub) subscribe(ctx context.Context) {
	h.logger.Info("websocket redis subscription started")
	pubsub := h.redis.PSubscribe(ctx, "room:*:events")
	defer pubsub.Close()
	ch := pubsub.Channel()
	for msg := range ch {
		var ev envelope
		if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil {
			h.logger.Warn("websocket redis event ignored", zap.String("channel", msg.Channel), zap.Error(err))
			continue
		}
		h.broadcastEnvelope(ev)
	}
	h.logger.Warn("websocket redis subscription stopped")
}
func (h *Hub) publish(roomID string, ev envelope) {
	if h.redis != nil {
		b, _ := json.Marshal(ev)
		if err := h.redis.Publish(context.Background(), "room:"+roomID+":events", b).Err(); err != nil {
			h.logger.Error("websocket publish failed", zap.String("room_id", roomID), zap.String("type", ev.Type), zap.Error(err))
		}
		return
	}
	h.broadcastEnvelope(ev)
}
func (h *Hub) broadcastEnvelope(ev envelope) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		if c.canReceive(ev) {
			select {
			case c.send <- ev:
			default:
				h.logger.Warn("websocket client send buffer full", zap.String("room_id", c.roomID), zap.String("user_id", c.userID), zap.String("type", ev.Type))
				close(c.send)
				delete(h.clients, c)
			}
		}
	}
}
func (c *client) canReceive(ev envelope) bool {
	bodyBytes, _ := json.Marshal(ev.Body)
	var m map[string]any
	_ = json.Unmarshal(bodyBytes, &m)
	if room, ok := m["room_id"].(string); ok && room != "" && room != c.roomID {
		return false
	}
	if room, ok := m["roomId"].(string); ok && room != "" && room != c.roomID {
		return false
	}
	if ev.Type == "chat.message" || ev.Type == "roll.result" {
		rec, _ := m["recipient_user_ids"].([]any)
		sender, _ := m["sender_user_id"].(string)
		if len(rec) == 0 {
			return true
		}
		if c.isDM || sender == c.userID {
			return true
		}
		for _, r := range rec {
			if fmt.Sprint(r) == c.userID {
				return true
			}
		}
		return false
	}
	return true
}

func (c *client) readLoop() {
	defer c.close()
	c.conn.SetReadLimit(1 << 20)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error { return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	for {
		var msg clientEnvelope
		if err := c.conn.ReadJSON(&msg); err != nil {
			return
		}
		c.handle(msg)
	}
}
func (c *client) writeLoop() {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	defer c.conn.Close()
	for {
		select {
		case ev, ok := <-c.send:
			if !ok {
				return
			}
			if err := c.conn.WriteJSON(ev); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second)); err != nil {
				return
			}
		}
	}
}
func (c *client) close() {
	closed := false
	c.hub.mu.Lock()
	if c.hub.clients[c] {
		delete(c.hub.clients, c)
		close(c.send)
		closed = true
	}
	c.hub.mu.Unlock()
	if closed {
		c.hub.logger.Info("websocket disconnected", zap.String("room_id", c.roomID), zap.String("user_id", c.userID))
	}
	c.conn.Close()
}
func (c *client) error(id, code, msg string) {
	fields := []zap.Field{zap.String("request_id", id), zap.String("code", code), zap.String("room_id", c.roomID), zap.String("user_id", c.userID)}
	if code == "db" {
		c.hub.logger.Error("websocket message failed", append(fields, zap.String("error", msg))...)
	} else {
		c.hub.logger.Warn("websocket message rejected", fields...)
	}
	c.send <- envelope{Type: "error", RequestID: &id, Body: map[string]string{"code": code, "message": msg}}
}

func (c *client) handle(msg clientEnvelope) {
	switch msg.Type {
	case "chat.send":
		c.chatSend(msg)
	case "token.move":
		c.tokenMove(msg)
	case "token.visibility":
		c.tokenVisibility(msg)
	case "structure.move":
		c.structureMove(msg)
	case "structure.visibility":
		c.structureVisibility(msg)
	case "structure.create":
		c.structureCreate(msg)
	case "structure.remove":
		c.structureRemove(msg)
	case "attack.resolve":
		c.attackResolve(msg)
	case "ruler.measure":
		var req struct {
			From game.Point `json:"from"`
			To   game.Point `json:"to"`
		}
		if json.Unmarshal(msg.Body, &req) != nil {
			c.error(msg.RequestID, "bad_json", "invalid body")
			return
		}
		c.send <- envelope{Type: "ruler.result", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "meters": game.MeasureDistanceMeters(req.From, req.To)}}
	default:
		c.error(msg.RequestID, "unknown_type", "unknown websocket message type")
	}
}

func (c *client) chatSend(msg clientEnvelope) {
	var req struct {
		Text             string   `json:"text"`
		RecipientUserIDs []string `json:"recipientUserIds"`
		RollExpression   string   `json:"rollExpression"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if len(req.RecipientUserIDs) > 0 && !c.isDM {
		c.error(msg.RequestID, "forbidden", "only DMs can send private messages")
		return
	}
	kind := "chat"
	if len(req.RecipientUserIDs) > 0 {
		kind = "dm"
	}
	var roll any
	body := req.Text
	if req.RollExpression != "" {
		rr, err := game.RollExpression(req.RollExpression, rand.Reader)
		if err != nil {
			c.error(msg.RequestID, "bad_roll", err.Error())
			return
		}
		kind = "roll"
		roll = rr
		b, _ := json.Marshal(rr)
		body = string(b)
	}
	tx, err := c.hub.pool.Begin(context.Background())
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(context.Background())
	id := uuid.New().String()
	rollJSON, _ := json.Marshal(roll)
	if roll == nil {
		rollJSON = nil
	}
	_, err = tx.Exec(context.Background(), `insert into chat_messages(id,room_id,sender_user_id,kind,body,roll) values($1,$2,$3,$4,$5,$6)`, id, c.roomID, c.userID, kind, body, rollJSON)
	if err == nil {
		for _, uid := range req.RecipientUserIDs {
			_, err = tx.Exec(context.Background(), `insert into chat_message_recipients(message_id,user_id) values($1,$2)`, id, uid)
			if err != nil {
				break
			}
		}
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	_ = tx.Commit(context.Background())
	bodyMap := map[string]any{"id": id, "room_id": c.roomID, "sender_user_id": c.userID, "kind": kind, "body": body, "roll": roll, "recipient_user_ids": req.RecipientUserIDs, "created_at": time.Now()}
	evType := "chat.message"
	if kind == "roll" {
		evType = "roll.result"
	}
	c.hub.publish(c.roomID, envelope{Type: evType, RequestID: &msg.RequestID, Body: bodyMap})
	if kind == "roll" {
		c.hub.publish(c.roomID, envelope{Type: "chat.message", RequestID: &msg.RequestID, Body: bodyMap})
	}
}

func (c *client) tokenMove(msg clientEnvelope) {
	var req struct {
		TokenID string       `json:"tokenId"`
		To      game.Point   `json:"to"`
		Path    []game.Point `json:"path"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	token, err := c.hub.loadToken(context.Background(), c.roomID, req.TokenID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "token not found")
		return
	}
	if !c.isDM && token.OwnerUserID != c.userID {
		c.error(msg.RequestID, "forbidden", "token ownership required")
		return
	}
	structures, _ := c.hub.loadStructures(context.Background(), c.roomID)
	if len(req.Path) == 0 {
		req.Path = []game.Point{{token.X, token.Y}, req.To}
	} else {
		req.Path = append([]game.Point{{token.X, token.Y}}, req.Path...)
		req.Path = append(req.Path, req.To)
	}
	if !game.CanMove(req.Path, structures, token) {
		c.error(msg.RequestID, "blocked_movement", "movement is blocked")
		return
	}
	_, err = c.hub.pool.Exec(context.Background(), `update room_tokens set x_m=$1,y_m=$2,updated_at=now() where id=$3`, req.To.X, req.To.Y, req.TokenID)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	c.hub.publish(c.roomID, envelope{Type: "token.moved", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "token_id": req.TokenID, "to": req.To}})
	c.hub.publish(c.roomID, envelope{Type: "vision.update", RequestID: nil, Body: map[string]any{"room_id": c.roomID, "version": time.Now().UnixNano()}})
}

func (c *client) tokenVisibility(msg clientEnvelope) {
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "DM required")
		return
	}
	var req struct {
		TokenID  string `json:"tokenId"`
		IsHidden bool   `json:"isHidden"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if _, err := c.hub.loadToken(context.Background(), c.roomID, req.TokenID); err != nil {
		c.error(msg.RequestID, "not_found", "token not found")
		return
	}
	if _, err := c.hub.pool.Exec(context.Background(), `update room_tokens set is_hidden=$1,updated_at=now() where id=$2`, req.IsHidden, req.TokenID); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	c.hub.publish(c.roomID, envelope{Type: "token.updated", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "token_id": req.TokenID, "is_hidden": req.IsHidden}})
	c.hub.publish(c.roomID, envelope{Type: "vision.update", RequestID: nil, Body: map[string]any{"room_id": c.roomID, "version": time.Now().UnixNano()}})
}

func (c *client) structureMove(msg clientEnvelope) {
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "DM required")
		return
	}
	var req struct {
		StructureID string       `json:"structureId"`
		Geometry    []game.Point `json:"geometry"`
	}
	if json.Unmarshal(msg.Body, &req) != nil || len(req.Geometry) == 0 {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	structure, roomMapID, err := c.hub.loadStructure(context.Background(), c.roomID, req.StructureID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "structure not found")
		return
	}
	if !isRigidTransform(structure.Geometry, req.Geometry) {
		c.error(msg.RequestID, "invalid_transform", "structures may only be moved or rotated at the table")
		return
	}
	geometry, _ := json.Marshal(req.Geometry)
	_, err = c.hub.pool.Exec(context.Background(), `insert into room_map_structure_states(room_map_id,structure_id,geometry) values($1,$2,$3) on conflict(room_map_id,structure_id) do update set geometry=excluded.geometry,updated_at=now()`, roomMapID, req.StructureID, json.RawMessage(geometry))
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	c.hub.publish(c.roomID, envelope{Type: "structure.moved", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "structure_id": req.StructureID, "geometry": req.Geometry}})
	c.hub.publish(c.roomID, envelope{Type: "vision.update", RequestID: nil, Body: map[string]any{"room_id": c.roomID, "version": time.Now().UnixNano()}})
}

func (c *client) structureVisibility(msg clientEnvelope) {
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "DM required")
		return
	}
	var req struct {
		StructureID string `json:"structureId"`
		IsHidden    bool   `json:"isHidden"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	_, roomMapID, err := c.hub.loadStructure(context.Background(), c.roomID, req.StructureID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "structure not found")
		return
	}
	_, err = c.hub.pool.Exec(context.Background(), `insert into room_map_structure_states(room_map_id,structure_id,is_hidden) values($1,$2,$3) on conflict(room_map_id,structure_id) do update set is_hidden=excluded.is_hidden,updated_at=now()`, roomMapID, req.StructureID, req.IsHidden)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	c.hub.publish(c.roomID, envelope{Type: "structure.updated", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "structure_id": req.StructureID, "is_hidden": req.IsHidden}})
	c.hub.publish(c.roomID, envelope{Type: "vision.update", RequestID: nil, Body: map[string]any{"room_id": c.roomID, "version": time.Now().UnixNano()}})
}

// maxStructurePoints bounds one placed structure; table templates use at most five points.
const maxStructurePoints = 64

var structureKinds = map[string]bool{"wall": true, "window": true, "door": true, "terrain": true, "cover": true}

// structureCreate places a structure on the room's active map only; the source map is untouched.
// A room without an active map gets a blank default map first, so one-shot tables need no prep.
func (c *client) structureCreate(msg clientEnvelope) {
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "DM required")
		return
	}
	var req struct {
		Kind           string       `json:"kind"`
		Geometry       []game.Point `json:"geometry"`
		BlocksVision   bool         `json:"blocks_vision"`
		BlocksMovement bool         `json:"blocks_movement"`
		BlocksAttacks  bool         `json:"blocks_attacks"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if !structureKinds[req.Kind] {
		c.error(msg.RequestID, "invalid_structure", "structure kind must be wall, window, door, terrain or cover")
		return
	}
	if len(req.Geometry) < 2 || len(req.Geometry) > maxStructurePoints {
		c.error(msg.RequestID, "invalid_structure", fmt.Sprintf("a structure needs between 2 and %d points", maxStructurePoints))
		return
	}
	for _, p := range req.Geometry {
		if math.IsNaN(p.X) || math.IsNaN(p.Y) || math.IsInf(p.X, 0) || math.IsInf(p.Y, 0) {
			c.error(msg.RequestID, "invalid_structure", "structure points must be finite numbers")
			return
		}
	}
	ctx := context.Background()
	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var roomMapID, mapID, startedMapID string
	err = tx.QueryRow(ctx, `select id::text,map_id::text from room_maps where room_id=$1 and is_active`, c.roomID).Scan(&roomMapID, &mapID)
	if errors.Is(err, pgx.ErrNoRows) {
		mapID, roomMapID, _, err = createActiveRoomMap(ctx, tx, c.roomID, c.userID, DefaultMapSpec)
		startedMapID = mapID
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	structure := game.Structure{ID: uuid.New().String(), Kind: req.Kind, Geometry: req.Geometry, BlocksVision: req.BlocksVision, BlocksMovement: req.BlocksMovement, BlocksAttacks: req.BlocksAttacks, PassRules: map[string]bool{}}
	geometry, _ := json.Marshal(structure.Geometry)
	_, err = tx.Exec(ctx, `insert into map_structures(id,map_id,room_map_id,kind,geometry,blocks_vision,blocks_movement,blocks_attacks,cover_bonus,pass_rules) values($1,$2,$3,$4,$5,$6,$7,$8,0,'{}'::jsonb)`, structure.ID, mapID, roomMapID, structure.Kind, json.RawMessage(geometry), structure.BlocksVision, structure.BlocksMovement, structure.BlocksAttacks)
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	if startedMapID != "" {
		c.hub.PublishMapActivated(c.roomID, startedMapID)
	}
	c.hub.publish(c.roomID, envelope{Type: "structure.created", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "structure": structure}})
	c.hub.publish(c.roomID, envelope{Type: "vision.update", RequestID: nil, Body: map[string]any{"room_id": c.roomID, "version": time.Now().UnixNano()}})
}

// structureRemove deletes a structure placed in this room, or hides a source-map structure
// from this room for good. The source map keeps its structures either way.
func (c *client) structureRemove(msg clientEnvelope) {
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
	ctx := context.Background()
	_, roomMapID, err := c.hub.loadStructure(ctx, c.roomID, req.StructureID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "structure not found")
		return
	}
	placed, err := c.hub.pool.Exec(ctx, `delete from map_structures where id=$1 and room_map_id=$2`, req.StructureID, roomMapID)
	if err == nil && placed.RowsAffected() == 0 {
		_, err = c.hub.pool.Exec(ctx, `insert into room_map_structure_states(room_map_id,structure_id,is_removed) values($1,$2,true) on conflict(room_map_id,structure_id) do update set is_removed=true,updated_at=now()`, roomMapID, req.StructureID)
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.bump(c.roomID)
	c.hub.publish(c.roomID, envelope{Type: "structure.removed", RequestID: &msg.RequestID, Body: map[string]any{"room_id": c.roomID, "structure_id": req.StructureID}})
	c.hub.publish(c.roomID, envelope{Type: "vision.update", RequestID: nil, Body: map[string]any{"room_id": c.roomID, "version": time.Now().UnixNano()}})
}

func (c *client) attackResolve(msg clientEnvelope) {
	var req struct {
		SourceTokenID string `json:"sourceTokenId"`
		TargetTokenID string `json:"targetTokenId"`
		AttackID      string `json:"attackId"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	ctx := context.Background()
	source, err := c.hub.loadToken(ctx, c.roomID, req.SourceTokenID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "source token not found")
		return
	}
	if !c.isDM && source.OwnerUserID != c.userID {
		c.error(msg.RequestID, "forbidden", "token ownership required")
		return
	}
	target, err := c.hub.loadToken(ctx, c.roomID, req.TargetTokenID)
	if err != nil || !c.isDM && target.IsHidden && target.OwnerUserID != c.userID {
		c.error(msg.RequestID, "not_found", "target token not found")
		return
	}
	if source.ID == target.ID {
		c.error(msg.RequestID, "invalid_target", "a token cannot attack itself")
		return
	}
	attacks, err := source.AttackList()
	if err != nil {
		c.error(msg.RequestID, "invalid_attacks", "this character's attacks are invalid; edit them and try again")
		return
	}
	var attack *game.Attack
	for i := range attacks {
		if attacks[i].ID == req.AttackID {
			attack = &attacks[i]
			break
		}
	}
	if attack == nil {
		c.error(msg.RequestID, "unknown_attack", "attack not found")
		return
	}
	from, to := game.Point{X: source.X, Y: source.Y}, game.Point{X: target.X, Y: target.Y}
	if !game.InAttackRange(from, to, attack.RangeM) {
		c.error(msg.RequestID, "out_of_range", "target is out of range")
		return
	}
	structures, _ := c.hub.loadStructures(ctx, c.roomID)
	if !game.CanTarget(from, to, structures, source) {
		c.error(msg.RequestID, "blocked_target", "target is blocked")
		return
	}
	resolved := game.ResolveAttack(*attack, source.Stats)
	atk, err := game.RollExpression(resolved.AttackExpression(), rand.Reader)
	if err != nil {
		c.error(msg.RequestID, "bad_roll", err.Error())
		return
	}
	dmg, err := game.RollExpression(resolved.DamageExpression(), rand.Reader)
	if err != nil {
		c.error(msg.RequestID, "bad_roll", err.Error())
		return
	}
	body := fmt.Sprintf("%s attacks %s with %s", source.Name, target.Name, attack.Name)
	roll := game.AttackRoll{RollResult: atk, Damage: dmg}
	id := uuid.New().String()
	rollJSON, _ := json.Marshal(roll)
	_, err = c.hub.pool.Exec(ctx, `insert into chat_messages(id,room_id,sender_user_id,kind,body,roll) values($1,$2,$3,'roll',$4,$5)`, id, c.roomID, c.userID, body, rollJSON)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.publish(c.roomID, envelope{Type: "roll.result", RequestID: &msg.RequestID, Body: map[string]any{"id": id, "room_id": c.roomID, "sender_user_id": c.userID, "kind": "roll", "body": body, "roll": roll, "recipient_user_ids": []string{}, "created_at": time.Now()}})
}

func (h *Hub) snapshot(ctx context.Context, roomID, userID string) map[string]any {
	var room json.RawMessage
	_ = h.pool.QueryRow(ctx, `select jsonb_build_object('id',id::text,'name',name,'invite_code',invite_code) from rooms where id=$1`, roomID).Scan(&room)
	return map[string]any{"room": room, "room_id": roomID}
}
func (h *Hub) isDM(ctx context.Context, userID, roomID string) bool {
	var ok bool
	_ = h.pool.QueryRow(ctx, `select exists(select 1 from room_members where room_id=$1 and user_id=$2 and is_dm)`, roomID, userID).Scan(&ok)
	return ok
}
func (h *Hub) loadStructures(ctx context.Context, roomID string) ([]game.Structure, error) {
	rows, err := h.pool.Query(ctx, `select ms.id::text,ms.kind,coalesce(rmss.geometry,ms.geometry),ms.blocks_vision,ms.blocks_movement,ms.blocks_attacks,ms.cover_bonus,ms.pass_rules,coalesce(rmss.is_hidden,false) from map_structures ms join room_maps rm on rm.map_id=ms.map_id left join room_map_structure_states rmss on rmss.room_map_id=rm.id and rmss.structure_id=ms.id where rm.room_id=$1 and rm.is_active and (ms.room_map_id is null or ms.room_map_id=rm.id) and not coalesce(rmss.is_removed,false)`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []game.Structure
	for rows.Next() {
		var id, kind string
		var geom, pr []byte
		var bv, bm, ba, hidden bool
		var cover int
		if err := rows.Scan(&id, &kind, &geom, &bv, &bm, &ba, &cover, &pr, &hidden); err != nil {
			return nil, err
		}
		structure := game.ParseStructure(id, kind, geom, pr, bv, bm, ba, cover)
		structure.IsHidden = hidden
		out = append(out, structure)
	}
	return out, rows.Err()
}
func (h *Hub) loadStructure(ctx context.Context, roomID, structureID string) (game.Structure, string, error) {
	var structure game.Structure
	var roomMapID string
	var geometry, passRules []byte
	var hidden bool
	err := h.pool.QueryRow(ctx, `select rm.id::text,ms.id::text,ms.kind,coalesce(rmss.geometry,ms.geometry),ms.blocks_vision,ms.blocks_movement,ms.blocks_attacks,ms.cover_bonus,ms.pass_rules,coalesce(rmss.is_hidden,false) from map_structures ms join room_maps rm on rm.map_id=ms.map_id left join room_map_structure_states rmss on rmss.room_map_id=rm.id and rmss.structure_id=ms.id where rm.room_id=$1 and rm.is_active and (ms.room_map_id is null or ms.room_map_id=rm.id) and not coalesce(rmss.is_removed,false) and ms.id=$2`, roomID, structureID).Scan(&roomMapID, &structure.ID, &structure.Kind, &geometry, &structure.BlocksVision, &structure.BlocksMovement, &structure.BlocksAttacks, &structure.CoverBonus, &passRules, &hidden)
	if err != nil {
		return structure, "", err
	}
	structure = game.ParseStructure(structure.ID, structure.Kind, geometry, passRules, structure.BlocksVision, structure.BlocksMovement, structure.BlocksAttacks, structure.CoverBonus)
	structure.IsHidden = hidden
	return structure, roomMapID, nil
}

func isRigidTransform(current, next []game.Point) bool {
	if len(current) == 0 || len(current) != len(next) {
		return false
	}
	var fromCenter, toCenter game.Point
	for index, point := range current {
		target := next[index]
		if math.IsNaN(point.X) || math.IsNaN(point.Y) || math.IsInf(point.X, 0) || math.IsInf(point.Y, 0) ||
			math.IsNaN(target.X) || math.IsNaN(target.Y) || math.IsInf(target.X, 0) || math.IsInf(target.Y, 0) {
			return false
		}
		fromCenter.X += point.X
		fromCenter.Y += point.Y
		toCenter.X += target.X
		toCenter.Y += target.Y
	}
	count := float64(len(current))
	fromCenter.X /= count
	fromCenter.Y /= count
	toCenter.X /= count
	toCenter.Y /= count

	// Fit one rotation after removing translation, without permitting scale or reflection.
	var dot, cross float64
	for index, point := range current {
		x, y := point.X-fromCenter.X, point.Y-fromCenter.Y
		tx, ty := next[index].X-toCenter.X, next[index].Y-toCenter.Y
		dot += x*tx + y*ty
		cross += x*ty - y*tx
	}
	sin, cos := math.Sincos(math.Atan2(cross, dot))
	// Canvas geometry is rounded to hundredths of a meter. Allow that rounding
	// around the fitted transform, but not resizing or independently moved vertices.
	const tolerance = 0.02
	for index, point := range current {
		x, y := point.X-fromCenter.X, point.Y-fromCenter.Y
		dx := toCenter.X + x*cos - y*sin - next[index].X
		dy := toCenter.Y + x*sin + y*cos - next[index].Y
		if !(math.Hypot(dx, dy) <= tolerance) {
			return false
		}
	}
	return true
}
func (h *Hub) loadToken(ctx context.Context, roomID, tokenID string) (game.Token, error) {
	var t game.Token
	var attrs, stats []byte
	err := h.pool.QueryRow(ctx, `select rt.id::text,coalesce(rt.owner_user_id::text,''),rt.name,rt.x_m::float8,rt.y_m::float8,rt.rotation_deg::float8,rt.size_m::float8,rt.vision_range_m::float8,rt.vision_angle_deg::float8,rt.is_hidden,rt.attributes,coalesce(rt.sheet_id::text,''),coalesce(s.user_id::text,''),coalesce(s.data,rt.attributes) from room_tokens rt join room_maps rm on rm.id=rt.room_map_id left join sheets s on s.id=rt.sheet_id where rm.room_id=$1 and rt.id=$2`, roomID, tokenID).Scan(&t.ID, &t.OwnerUserID, &t.Name, &t.X, &t.Y, &t.RotationDeg, &t.SizeM, &t.VisionRangeM, &t.VisionAngleDeg, &t.IsHidden, &attrs, &t.SheetID, &t.SheetOwnerUserID, &stats)
	if err != nil {
		return t, err
	}
	_ = json.Unmarshal(attrs, &t.Attributes)
	_ = json.Unmarshal(stats, &t.Stats)
	return t, nil
}

// PublishTokenUpdated notifies room clients to reload after an HTTP-side token change.
func (h *Hub) PublishTokenUpdated(roomID, tokenID string) {
	h.publish(roomID, envelope{Type: "token.updated", Body: map[string]any{"room_id": roomID, "token_id": tokenID}})
}
func (h *Hub) bump(roomID string) {
	if h.redis != nil {
		_ = h.redis.Incr(context.Background(), "room:"+roomID+":version").Err()
	}
}
