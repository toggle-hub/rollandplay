package ws

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// Presence: every open room socket is a member "<user id>|<connection id>" of the Redis sorted
// set room:{id}:presence, scored with the Unix millisecond it stops counting. Each backend renews
// its own sockets on a heartbeat, so sockets of a backend that stopped without closing them drop
// out after presenceTTL. Without Redis the hub's own sockets are the whole picture.
const (
	presenceTTL       = 60 * time.Second
	presenceHeartbeat = 20 * time.Second
	presenceTimeout   = 5 * time.Second
)

func presenceKey(roomID string) string { return "room:" + roomID + ":presence" }

func presenceExpiry(now time.Time) float64 { return float64(now.Add(presenceTTL).UnixMilli()) }

func (c *client) presenceMember() string { return c.userID + "|" + c.connID }

// presenceJoin marks this socket as at the table and tells the room who is connected now.
func (h *Hub) presenceJoin(c *client) {
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), presenceTimeout)
		defer cancel()
		key := presenceKey(c.roomID)
		_, err := h.redis.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
			pipe.ZAdd(ctx, key, redis.Z{Score: presenceExpiry(time.Now()), Member: c.presenceMember()})
			pipe.Expire(ctx, key, presenceTTL)
			return nil
		})
		if err != nil {
			h.logger.Warn("presence join failed", zap.String("room_id", c.roomID), zap.String("user_id", c.userID), zap.Error(err))
		}
	}
	h.publishPresence(c.roomID, c.userID)
}

// presenceLeave removes this socket; its user stays online while another of their sockets is open.
func (h *Hub) presenceLeave(c *client) {
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), presenceTimeout)
		defer cancel()
		if err := h.redis.ZRem(ctx, presenceKey(c.roomID), c.presenceMember()).Err(); err != nil {
			h.logger.Warn("presence leave failed", zap.String("room_id", c.roomID), zap.String("user_id", c.userID), zap.Error(err))
		}
	}
	h.publishPresence(c.roomID, c.userID)
}

// onlineUserIDs lists, sorted, the users with an open socket in the room on any backend.
func (h *Hub) onlineUserIDs(ctx context.Context, roomID string) ([]string, error) {
	ids := []string{}
	if h.redis == nil {
		h.mu.Lock()
		for c := range h.clients {
			if c.roomID == roomID {
				ids = append(ids, c.userID)
			}
		}
		h.mu.Unlock()
	} else {
		now := strconv.FormatInt(time.Now().UnixMilli(), 10)
		members, err := h.redis.ZRangeByScore(ctx, presenceKey(roomID), &redis.ZRangeBy{Min: now, Max: "+inf"}).Result()
		if err != nil {
			return nil, err
		}
		for _, member := range members {
			userID, _, _ := strings.Cut(member, "|")
			ids = append(ids, userID)
		}
	}
	slices.Sort(ids)
	return slices.Compact(ids), nil
}

// publishPresence sends the room its full list of connected users. userID names the user whose
// socket joined or left; it is empty when stale sockets were dropped.
func (h *Hub) publishPresence(roomID, userID string) {
	ctx, cancel := context.WithTimeout(context.Background(), presenceTimeout)
	defer cancel()
	ids, err := h.onlineUserIDs(ctx, roomID)
	if err != nil {
		h.logger.Warn("presence lookup failed", zap.String("room_id", roomID), zap.Error(err))
		return
	}
	body := map[string]any{"room_id": roomID, "online_user_ids": ids}
	if userID != "" {
		body["user_id"] = userID
		body["online"] = slices.Contains(ids, userID)
	}
	h.publish(roomID, envelope{Type: "presence.changed", Body: body})
}

// presenceHeartbeat renews this backend's sockets until Redis is closed.
func (h *Hub) presenceHeartbeat(ctx context.Context) {
	ticker := time.NewTicker(presenceHeartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if errors.Is(h.renewPresence(ctx), redis.ErrClosed) {
				return
			}
		}
	}
}

// renewPresence extends this backend's sockets and drops expired ones, telling a room who is
// still connected when that removed someone.
func (h *Hub) renewPresence(ctx context.Context) error {
	h.mu.Lock()
	rooms := map[string][]*client{}
	for c := range h.clients {
		rooms[c.roomID] = append(rooms[c.roomID], c)
	}
	h.mu.Unlock()
	for roomID, clients := range rooms {
		now := time.Now()
		key := presenceKey(roomID)
		entries := make([]redis.Z, len(clients))
		for i, c := range clients {
			entries[i] = redis.Z{Score: presenceExpiry(now), Member: c.presenceMember()}
		}
		var expired *redis.IntCmd
		renew, cancel := context.WithTimeout(ctx, presenceTimeout)
		_, err := h.redis.TxPipelined(renew, func(pipe redis.Pipeliner) error {
			pipe.ZAdd(renew, key, entries...)
			expired = pipe.ZRemRangeByScore(renew, key, "-inf", "("+strconv.FormatInt(now.UnixMilli(), 10))
			pipe.Expire(renew, key, presenceTTL)
			return nil
		})
		if err != nil {
			cancel()
			h.logger.Warn("presence renewal failed", zap.String("room_id", roomID), zap.Error(err))
			if errors.Is(err, redis.ErrClosed) {
				return err
			}
			continue
		}
		// A socket that closed while this ran may have been renewed after it left; remove it again.
		var closed []any
		h.mu.Lock()
		for _, c := range clients {
			if !h.clients[c] {
				closed = append(closed, c.presenceMember())
			}
		}
		h.mu.Unlock()
		if len(closed) > 0 {
			if err := h.redis.ZRem(renew, key, closed...).Err(); err != nil {
				h.logger.Warn("presence cleanup failed", zap.String("room_id", roomID), zap.Error(err))
			}
		}
		cancel()
		if expired.Val() > 0 {
			h.publishPresence(roomID, "")
		}
	}
	return nil
}
