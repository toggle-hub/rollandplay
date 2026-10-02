package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"rollandplay/backend/internal/config"
	"rollandplay/backend/internal/email"
)

var ErrUnauthorized = errors.New("unauthorized")
var ErrForbidden = errors.New("forbidden")
var ErrNotFound = errors.New("not found")

type User struct {
	ID              string `json:"id"`
	Username        string `json:"username"`
	Email           string `json:"email"`
	Pronouns        string `json:"pronouns"`
	ProfileComplete bool   `json:"profile_complete"`
}
type Session struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Token     string    `json:"-"`
	ExpiresAt time.Time `json:"expiresAt"`
}

var pool *pgxpool.Pool
var rdb *redis.Client
var cfg config.Config

func Init(p *pgxpool.Pool, r *redis.Client, c config.Config) { pool = p; rdb = r; cfg = c }

func CreateMagicLink(ctx context.Context, rawEmail string) (url string, err error) {
	emailAddr := strings.ToLower(strings.TrimSpace(rawEmail))
	if !strings.Contains(emailAddr, "@") {
		return "", fmt.Errorf("invalid email")
	}
	id := uuid.New().String()
	username := safeUsername(emailAddr)
	var user User
	err = pool.QueryRow(ctx, `insert into users(id,username,email) values($1,$2,$3) on conflict(email) do update set updated_at=users.updated_at returning id::text, username, email::text, pronouns, profile_complete`, id, username, emailAddr).Scan(&user.ID, &user.Username, &user.Email, &user.Pronouns, &user.ProfileComplete)
	if err != nil && strings.Contains(err.Error(), "users_username_key") {
		username = username + "-" + id[:6]
		err = pool.QueryRow(ctx, `insert into users(id,username,email) values($1,$2,$3) on conflict(email) do update set updated_at=users.updated_at returning id::text, username, email::text, pronouns, profile_complete`, id, username, emailAddr).Scan(&user.ID, &user.Username, &user.Email, &user.Pronouns, &user.ProfileComplete)
	}
	if err != nil {
		return "", err
	}
	raw, err := randomToken(32)
	if err != nil {
		return "", err
	}
	h := hash(raw)
	_, err = pool.Exec(ctx, `insert into auth_magic_links(id,email,user_id,token_hash,expires_at) values($1,$2,$3,$4,$5)`, uuid.New().String(), emailAddr, user.ID, h, time.Now().Add(cfg.MagicLinkTTL))
	if err != nil {
		return "", err
	}
	url = strings.TrimRight(cfg.PublicBaseURL, "/") + "/auth/consume?token=" + raw
	if rdb != nil {
		if err := email.Enqueue(ctx, rdb, emailAddr, "Your Rollandplay sign-in link", url); err != nil {
			return "", err
		}
	}
	return url, nil
}

func ConsumeMagicLink(ctx context.Context, rawToken string) (Session, User, error) {
	if rawToken == "" {
		return Session{}, User{}, ErrUnauthorized
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Session{}, User{}, err
	}
	defer tx.Rollback(ctx)
	var linkID, userID string
	var expires time.Time
	var consumed *time.Time
	err = tx.QueryRow(ctx, `select id::text,user_id::text,expires_at,consumed_at from auth_magic_links where token_hash=$1 for update`, hash(rawToken)).Scan(&linkID, &userID, &expires, &consumed)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, User{}, ErrUnauthorized
	}
	if err != nil {
		return Session{}, User{}, err
	}
	if consumed != nil || time.Now().After(expires) {
		return Session{}, User{}, ErrUnauthorized
	}
	if _, err := tx.Exec(ctx, `update auth_magic_links set consumed_at=now() where id=$1`, linkID); err != nil {
		return Session{}, User{}, err
	}
	rawSession, err := randomToken(32)
	if err != nil {
		return Session{}, User{}, err
	}
	s := Session{ID: uuid.New().String(), UserID: userID, Token: rawSession, ExpiresAt: time.Now().Add(cfg.SessionTTL)}
	if _, err := tx.Exec(ctx, `insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,$4)`, s.ID, s.UserID, hash(rawSession), s.ExpiresAt); err != nil {
		return Session{}, User{}, err
	}
	var u User
	if err := tx.QueryRow(ctx, `select id::text,username,email::text,pronouns,profile_complete from users where id=$1`, userID).Scan(&u.ID, &u.Username, &u.Email, &u.Pronouns, &u.ProfileComplete); err != nil {
		return Session{}, User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, User{}, err
	}
	return s, u, nil
}

func AuthenticateRequest(r *http.Request) (User, Session, error) {
	if pool == nil {
		return User{}, Session{}, ErrUnauthorized
	}
	c, err := r.Cookie(cfg.SessionCookieName)
	if err != nil || c.Value == "" {
		return User{}, Session{}, ErrUnauthorized
	}
	var u User
	var s Session
	err = pool.QueryRow(r.Context(), `select u.id::text,u.username,u.email::text,u.pronouns,u.profile_complete,s.id::text,s.user_id::text,s.expires_at from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now()`, hash(c.Value)).Scan(&u.ID, &u.Username, &u.Email, &u.Pronouns, &u.ProfileComplete, &s.ID, &s.UserID, &s.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, Session{}, ErrUnauthorized
	}
	if err != nil {
		return User{}, Session{}, err
	}
	s.Token = c.Value
	return u, s, nil
}

func RevokeSession(ctx context.Context, sessionID string) error {
	_, err := pool.Exec(ctx, `update sessions set revoked_at=now() where id=$1`, sessionID)
	return err
}
func CookieName() string { return cfg.SessionCookieName }
func SessionMaxAge() int { return int(cfg.SessionTTL.Seconds()) }

func RequireRoomMember(ctx context.Context, userID, roomID string) error {
	var exists bool
	err := pool.QueryRow(ctx, `select exists(select 1 from room_members where user_id=$1 and room_id=$2)`, userID, roomID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrForbidden
	}
	return nil
}
func RequireRoomDM(ctx context.Context, userID, roomID string) error {
	var exists bool
	err := pool.QueryRow(ctx, `select exists(select 1 from room_members where user_id=$1 and room_id=$2 and is_dm)`, userID, roomID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrForbidden
	}
	return nil
}
func CanEditMap(ctx context.Context, userID, mapID string) error {
	var exists bool
	err := pool.QueryRow(ctx, `select exists(select 1 from maps where id=$1 and owner_id=$2 union select 1 from map_editors where map_id=$1 and user_id=$2)`, mapID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrForbidden
	}
	return nil
}
func CanEditRuleBook(ctx context.Context, userID, ruleBookID string) error {
	var exists bool
	err := pool.QueryRow(ctx, `select exists(select 1 from rule_books where id=$1 and owner_id=$2 union select 1 from rule_book_editors where rule_book_id=$1 and user_id=$2)`, ruleBookID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrForbidden
	}
	return nil
}

func hash(raw string) string { sum := sha256.Sum256([]byte(raw)); return hex.EncodeToString(sum[:]) }
func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

var userRE = regexp.MustCompile(`[^a-z0-9_-]+`)

func safeUsername(email string) string {
	local := strings.ToLower(strings.Split(email, "@")[0])
	local = userRE.ReplaceAllString(local, "-")
	local = strings.Trim(local, "-")
	if local == "" {
		local = "player"
	}
	return local
}
