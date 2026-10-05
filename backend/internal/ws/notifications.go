package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"rollandplay/backend/internal/auth"
)

// Notification tells a user that their friend requests or room invitations changed. Clients reload
// GET /api/notifications on every notification; Actor and Room only word the alert.
type Notification struct {
	Kind  string            `json:"kind"`
	Actor *NotificationUser `json:"actor,omitempty"`
	Room  *NotificationRoom `json:"room,omitempty"`
}

// Notification kinds.
const (
	FriendRequested        = "friend.requested"         // to the addressee of a new request
	FriendAccepted         = "friend.accepted"          // to the requester
	FriendChanged          = "friend.changed"           // to the other user: cancelled, declined, removed or blocked
	RoomInvitationCreated  = "room_invitation.created"  // to the invitee
	RoomInvitationAccepted = "room_invitation.accepted" // to the inviter
	RoomInvitationRemoved  = "room_invitation.removed"  // to the other side: declined by the invitee or revoked by a game master
)

type NotificationUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Pronouns string `json:"pronouns"`
}

type NotificationRoom struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Notifier pushes notifications to every open notification socket of a user. With Redis, a
// notification published on any backend instance reaches sockets held by all of them.
type Notifier struct {
	redis    *redis.Client
	logger   *zap.Logger
	upgrader websocket.Upgrader
	mu       sync.Mutex
	clients  map[string]map[*notificationClient]struct{} // by user ID
}

type notificationClient struct {
	notifier *Notifier
	conn     *websocket.Conn
	userID   string
	send     chan envelope
}

const (
	notificationChannelPrefix = "user:"
	notificationChannelSuffix = ":notifications"
)

func NewNotifier(rdb *redis.Client, logger *zap.Logger) *Notifier {
	if logger == nil {
		logger = zap.NewNop()
	}
	n := &Notifier{redis: rdb, logger: logger, clients: map[string]map[*notificationClient]struct{}{}, upgrader: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}}
	if rdb != nil {
		go n.subscribe(context.Background())
	}
	return n
}

// Handle upgrades GET /api/notifications/ws for the signed-in user. The socket only carries
// server notifications; anything the client sends is ignored.
func (n *Notifier) Handle(w http.ResponseWriter, r *http.Request) {
	u, _, err := auth.AuthenticateRequest(r)
	if err != nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	conn, err := n.upgrader.Upgrade(w, r, nil)
	if err != nil {
		n.logger.Warn("notification websocket upgrade failed", zap.String("user_id", u.ID), zap.Error(err))
		return
	}
	c := &notificationClient{notifier: n, conn: conn, userID: u.ID, send: make(chan envelope, 16)}
	n.mu.Lock()
	if n.clients[u.ID] == nil {
		n.clients[u.ID] = map[*notificationClient]struct{}{}
	}
	n.clients[u.ID][c] = struct{}{}
	n.mu.Unlock()
	go c.writeLoop()
	go c.readLoop()
}

// Notify sends a notification to every open socket of userID.
func (n *Notifier) Notify(userID string, note Notification) {
	if n.redis == nil {
		n.deliver(userID, note)
		return
	}
	b, _ := json.Marshal(note)
	if err := n.redis.Publish(context.Background(), notificationChannelPrefix+userID+notificationChannelSuffix, b).Err(); err != nil {
		n.logger.Error("notification publish failed", zap.String("user_id", userID), zap.String("kind", note.Kind), zap.Error(err))
	}
}

func (n *Notifier) subscribe(ctx context.Context) {
	pubsub := n.redis.PSubscribe(ctx, notificationChannelPrefix+"*"+notificationChannelSuffix)
	defer pubsub.Close()
	for msg := range pubsub.Channel() {
		var note Notification
		if err := json.Unmarshal([]byte(msg.Payload), &note); err != nil {
			n.logger.Warn("notification redis event ignored", zap.String("channel", msg.Channel), zap.Error(err))
			continue
		}
		n.deliver(strings.TrimSuffix(strings.TrimPrefix(msg.Channel, notificationChannelPrefix), notificationChannelSuffix), note)
	}
	n.logger.Warn("notification redis subscription stopped")
}

func (n *Notifier) deliver(userID string, note Notification) {
	n.mu.Lock()
	defer n.mu.Unlock()
	for c := range n.clients[userID] {
		select {
		case c.send <- envelope{Type: "notification", Body: note}:
		default:
			// A client this far behind reconnects and reloads its notifications.
			n.removeLocked(c)
		}
	}
}

// removeLocked unregisters c and closes its send channel, which ends its write loop; n.mu must be held.
func (n *Notifier) removeLocked(c *notificationClient) {
	clients := n.clients[c.userID]
	if _, ok := clients[c]; !ok {
		return
	}
	delete(clients, c)
	if len(clients) == 0 {
		delete(n.clients, c.userID)
	}
	close(c.send)
}

func (c *notificationClient) readLoop() {
	defer func() {
		c.notifier.mu.Lock()
		c.notifier.removeLocked(c)
		c.notifier.mu.Unlock()
		c.conn.Close()
	}()
	c.conn.SetReadLimit(512)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error { return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	for {
		if _, _, err := c.conn.NextReader(); err != nil {
			return
		}
	}
}

func (c *notificationClient) writeLoop() {
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
