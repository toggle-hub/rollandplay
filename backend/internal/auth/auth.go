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

// Session is one sign-in, found through the request's access token.
type Session struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"` // when the request's access token expires
}

// Tokens are the cookie values a sign-in or a refresh hands out. Refresh is empty when a
// concurrent refresh already rotated the refresh token; the browser holds the newer one.
type Tokens struct {
	Access  string
	Refresh string
}

// ErrRefreshReused reports a refresh token that had already been rotated away. The sign-in it
// belonged to is revoked, because the token may have been stolen.
var ErrRefreshReused = errors.New("refresh token reused")

// refreshGrace is how long a just-rotated refresh token still renews access, so tabs that
// refresh at the same moment don't sign each other out.
const refreshGrace = 30 * time.Second

// refreshCookiePath limits the refresh cookie to the refresh and logout endpoints.
const refreshCookiePath = "/api/auth"

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

// ConsumeMagicLink signs the link's user in: a new sign-in with an access and a refresh token.
func ConsumeMagicLink(ctx context.Context, rawToken string) (Tokens, User, error) {
	if rawToken == "" {
		return Tokens{}, User{}, ErrUnauthorized
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Tokens{}, User{}, err
	}
	defer tx.Rollback(ctx)
	var linkID, userID string
	var expires time.Time
	var consumed *time.Time
	err = tx.QueryRow(ctx, `select id::text,user_id::text,expires_at,consumed_at from auth_magic_links where token_hash=$1 for update`, hash(rawToken)).Scan(&linkID, &userID, &expires, &consumed)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tokens{}, User{}, ErrUnauthorized
	}
	if err != nil {
		return Tokens{}, User{}, err
	}
	if consumed != nil || time.Now().After(expires) {
		return Tokens{}, User{}, ErrUnauthorized
	}
	if _, err := tx.Exec(ctx, `update auth_magic_links set consumed_at=now() where id=$1`, linkID); err != nil {
		return Tokens{}, User{}, err
	}
	refresh, err := randomToken(32)
	if err != nil {
		return Tokens{}, User{}, err
	}
	sessionID := uuid.New().String()
	if _, err := tx.Exec(ctx, `insert into sessions(id,user_id,refresh_hash,expires_at) values($1,$2,$3,$4)`, sessionID, userID, hash(refresh), time.Now().Add(cfg.SessionTTL)); err != nil {
		return Tokens{}, User{}, err
	}
	access, err := issueAccess(ctx, tx, sessionID)
	if err != nil {
		return Tokens{}, User{}, err
	}
	var u User
	if err := tx.QueryRow(ctx, `select id::text,username,email::text,pronouns,profile_complete from users where id=$1`, userID).Scan(&u.ID, &u.Username, &u.Email, &u.Pronouns, &u.ProfileComplete); err != nil {
		return Tokens{}, User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Tokens{}, User{}, err
	}
	return Tokens{Access: access, Refresh: refresh}, u, nil
}

func issueAccess(ctx context.Context, tx pgx.Tx, sessionID string) (string, error) {
	raw, err := randomToken(32)
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `insert into session_access_tokens(token_hash,session_id,expires_at) values($1,$2,$3)`, hash(raw), sessionID, time.Now().Add(cfg.AccessTTL))
	return raw, err
}

// AuthenticateRequest finds the user behind the request's access cookie.
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
	err = pool.QueryRow(r.Context(), `select u.id::text,u.username,u.email::text,u.pronouns,u.profile_complete,s.id::text,s.user_id::text,a.expires_at from session_access_tokens a join sessions s on s.id=a.session_id join users u on u.id=s.user_id where a.token_hash=$1 and a.expires_at>now() and s.revoked_at is null and s.expires_at>now()`, hash(c.Value)).Scan(&u.ID, &u.Username, &u.Email, &u.Pronouns, &u.ProfileComplete, &s.ID, &s.UserID, &s.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, Session{}, ErrUnauthorized
	}
	if err != nil {
		return User{}, Session{}, err
	}
	return u, s, nil
}

// Refresh trades a refresh token for a new access token and rotates the refresh token, which
// also extends the sign-in by SessionTTL. A token rotated away less than refreshGrace ago (a
// concurrent refresh from another tab) still gets an access token, but no new refresh token.
// An older rotated-away token revokes the sign-in and returns ErrRefreshReused.
func Refresh(ctx context.Context, rawRefresh string) (Tokens, error) {
	if rawRefresh == "" {
		return Tokens{}, ErrUnauthorized
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Tokens{}, err
	}
	defer tx.Rollback(ctx)
	h := hash(rawRefresh)
	var sessionID string
	var current, inGrace bool
	err = tx.QueryRow(ctx, `select id::text, refresh_hash=$1, coalesce(refreshed_at > now() - make_interval(secs => $2), false) from sessions where (refresh_hash=$1 or previous_refresh_hash=$1) and revoked_at is null and expires_at>now() for update`, h, refreshGrace.Seconds()).Scan(&sessionID, &current, &inGrace)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tokens{}, ErrUnauthorized
	}
	if err != nil {
		return Tokens{}, err
	}
	var tokens Tokens
	switch {
	case current:
		if tokens.Refresh, err = randomToken(32); err != nil {
			return Tokens{}, err
		}
		if _, err := tx.Exec(ctx, `update sessions set previous_refresh_hash=refresh_hash, refresh_hash=$2, refreshed_at=now(), expires_at=$3 where id=$1`, sessionID, hash(tokens.Refresh), time.Now().Add(cfg.SessionTTL)); err != nil {
			return Tokens{}, err
		}
	case inGrace:
		// Another tab rotated this token a moment ago; the browser already holds the new one.
	default:
		if err := revoke(ctx, tx, sessionID); err != nil {
			return Tokens{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return Tokens{}, err
		}
		return Tokens{}, ErrRefreshReused
	}
	if _, err := tx.Exec(ctx, `delete from session_access_tokens where session_id=$1 and expires_at<=now()`, sessionID); err != nil {
		return Tokens{}, err
	}
	if tokens.Access, err = issueAccess(ctx, tx, sessionID); err != nil {
		return Tokens{}, err
	}
	return tokens, tx.Commit(ctx)
}

// RevokeRequestSession ends the sign-in behind the request's access cookie, or behind its
// refresh cookie when the access token has already expired. Without either it does nothing.
func RevokeRequestSession(r *http.Request) error {
	ctx := r.Context()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var sessionID string
	if c, err := r.Cookie(cfg.SessionCookieName); err == nil && c.Value != "" {
		err := tx.QueryRow(ctx, `select session_id::text from session_access_tokens where token_hash=$1`, hash(c.Value)).Scan(&sessionID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	if c, err := r.Cookie(RefreshCookieName()); sessionID == "" && err == nil && c.Value != "" {
		err := tx.QueryRow(ctx, `select id::text from sessions where refresh_hash=$1 or previous_refresh_hash=$1`, hash(c.Value)).Scan(&sessionID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	if sessionID == "" {
		return nil
	}
	if err := revoke(ctx, tx, sessionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func revoke(ctx context.Context, tx pgx.Tx, sessionID string) error {
	if _, err := tx.Exec(ctx, `update sessions set revoked_at=coalesce(revoked_at,now()) where id=$1`, sessionID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `delete from session_access_tokens where session_id=$1`, sessionID)
	return err
}

// RefreshCookieName is the refresh token's cookie; browsers send it only to /api/auth endpoints.
func RefreshCookieName() string { return cfg.SessionCookieName + "_refresh" }

// AccessTTL is how long an access token lasts; clients refresh before it runs out.
func AccessTTL() time.Duration { return cfg.AccessTTL }

// SetCookies stores a sign-in's tokens in the browser. The refresh cookie is left as it is when
// tokens carries no refresh token.
func SetCookies(w http.ResponseWriter, tokens Tokens) {
	http.SetCookie(w, accessCookie(tokens.Access, int(cfg.AccessTTL.Seconds())))
	if tokens.Refresh != "" {
		http.SetCookie(w, refreshCookie(tokens.Refresh, int(cfg.SessionTTL.Seconds())))
	}
}

// ClearCookies removes both sign-in cookies.
func ClearCookies(w http.ResponseWriter) {
	http.SetCookie(w, accessCookie("", -1))
	http.SetCookie(w, refreshCookie("", -1))
}

func accessCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: cfg.SessionCookieName, Value: value, Path: "/", HttpOnly: true, Secure: secureCookies(), SameSite: http.SameSiteLaxMode, MaxAge: maxAge}
}

func refreshCookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: RefreshCookieName(), Value: value, Path: refreshCookiePath, HttpOnly: true, Secure: secureCookies(), SameSite: http.SameSiteStrictMode, MaxAge: maxAge}
}

// secureCookies keeps sign-in cookies off plain HTTP wherever the site is served over HTTPS.
func secureCookies() bool { return strings.HasPrefix(cfg.PublicBaseURL, "https://") }

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
