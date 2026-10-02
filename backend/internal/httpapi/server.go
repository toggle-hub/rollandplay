package httpapi

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"mime/multipart"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"rollandplay/backend/internal/assets"
	"rollandplay/backend/internal/auth"
	"rollandplay/backend/internal/config"
	"rollandplay/backend/internal/game"
	"rollandplay/backend/internal/telemetry"
	"rollandplay/backend/internal/ws"
)

type Server struct {
	Pool   *pgxpool.Pool
	Redis  *redis.Client
	Config config.Config
	Assets assets.Store
	Hub    *ws.Hub
	Logger *zap.Logger
}

func New(pool *pgxpool.Pool, rdb *redis.Client, cfg config.Config) *Server {
	return NewWithLogger(pool, rdb, cfg, zap.NewNop())
}

func NewWithLogger(pool *pgxpool.Pool, rdb *redis.Client, cfg config.Config, logger *zap.Logger) *Server {
	if logger == nil {
		logger = zap.NewNop()
	}
	s := &Server{Pool: pool, Redis: rdb, Config: cfg, Assets: assets.Store{Dir: cfg.AssetStorageDir}, Logger: logger}
	s.Hub = ws.NewHubWithLogger(pool, rdb, logger.Named("websocket"))
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/magic-link", s.handleMagicLink)
	mux.HandleFunc("POST /api/auth/consume", s.handleConsume)
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("PATCH /api/me", s.handleMePatch)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/rooms", s.handleRoomsList)
	mux.HandleFunc("POST /api/rooms", s.handleRoomsCreate)
	mux.HandleFunc("GET /api/rooms/{roomID}", s.handleRoomGet)
	mux.HandleFunc("PATCH /api/rooms/{roomID}", s.handleRoomPatch)
	mux.HandleFunc("POST /api/rooms/join", s.handleRoomJoin)
	mux.HandleFunc("GET /api/invites/{code}", s.handleInviteGet)
	mux.HandleFunc("GET /api/rooms/{roomID}/members", s.handleMembers)
	mux.HandleFunc("PATCH /api/rooms/{roomID}/members/{userID}", s.handleMemberPatch)
	mux.HandleFunc("GET /api/friends", s.handleFriendsList)
	mux.HandleFunc("POST /api/friends", s.handleFriendCreate)
	mux.HandleFunc("PATCH /api/friends/{friendID}", s.handleFriendPatch)
	mux.HandleFunc("DELETE /api/friends/{friendID}", s.handleFriendDelete)
	mux.HandleFunc("GET /api/rule-books", s.handleRuleBooksList)
	mux.HandleFunc("POST /api/rule-books", s.handleRuleBookCreate)
	mux.HandleFunc("GET /api/rule-books/{ruleBookID}", s.handleRuleBookGet)
	mux.HandleFunc("PATCH /api/rule-books/{ruleBookID}", s.handleRuleBookPatch)
	mux.HandleFunc("POST /api/rule-books/{ruleBookID}/editors", s.handleRuleBookEditor)
	mux.HandleFunc("GET /api/sheets", s.handleSheetsList)
	mux.HandleFunc("POST /api/sheets", s.handleSheetCreate)
	mux.HandleFunc("GET /api/sheets/{sheetID}", s.handleSheetGet)
	mux.HandleFunc("PATCH /api/sheets/{sheetID}", s.handleSheetPatch)
	mux.HandleFunc("GET /api/maps", s.handleMapsList)
	mux.HandleFunc("POST /api/maps", s.handleMapCreate)
	mux.HandleFunc("GET /api/maps/{mapID}", s.handleMapGet)
	mux.HandleFunc("PATCH /api/maps/{mapID}", s.handleMapPatch)
	mux.HandleFunc("POST /api/maps/{mapID}/editors", s.handleMapEditor)
	mux.HandleFunc("POST /api/maps/{mapID}/structures", s.handleStructureCreate)
	mux.HandleFunc("PATCH /api/maps/{mapID}/structures/{structureID}", s.handleStructurePatch)
	mux.HandleFunc("DELETE /api/maps/{mapID}/structures/{structureID}", s.handleStructureDelete)
	mux.HandleFunc("POST /api/assets", s.handleAssetUpload)
	mux.HandleFunc("POST /api/rooms/{roomID}/maps", s.handleRoomMapAttach)
	mux.HandleFunc("POST /api/rooms/{roomID}/maps/new", s.handleRoomMapNew)
	mux.HandleFunc("PATCH /api/rooms/{roomID}/maps/{roomMapID}", s.handleRoomMapPatch)
	mux.HandleFunc("GET /api/rooms/{roomID}/state", s.handleRoomState)
	mux.HandleFunc("POST /api/rooms/{roomID}/tokens", s.handleTokenCreate)
	mux.HandleFunc("PATCH /api/rooms/{roomID}/tokens/{tokenID}/attacks", s.handleTokenAttacksPatch)
	mux.HandleFunc("GET /api/rooms/{roomID}/ws", s.Hub.Handle)
	return telemetry.HTTPHandler(requestLogger(cors(mux), s.Logger.Named("http")))
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *responseRecorder) WriteHeader(status int) {
	if r.status != 0 {
		return
	}
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

func (r *responseRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (r *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

func requestLogger(next http.Handler, logger *zap.Logger) http.Handler {
	if logger == nil {
		logger = zap.NewNop()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &responseRecorder{ResponseWriter: w}
		defer func() {
			recovered := recover()
			if rec.status == 0 {
				if recovered != nil {
					rec.status = http.StatusInternalServerError
				} else {
					rec.status = http.StatusOK
				}
			}
			fields := []zap.Field{
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.Int("status", rec.status),
				zap.Int("bytes", rec.bytes),
				zap.Duration("duration", time.Since(start)),
				zap.String("remote_addr", r.RemoteAddr),
				zap.String("user_agent", r.UserAgent()),
			}
			if recovered != nil {
				logger.Error("http request panic", append(fields, zap.Any("panic", recovered))...)
				panic(recovered)
			}
			switch {
			case rec.status >= 500:
				logger.Error("http request", fields...)
			case rec.status >= 400:
				logger.Warn("http request", fields...)
			default:
				logger.Info("http request", fields...)
			}
		}()
		next.ServeHTTP(rec, r)
	})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin(r))
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func origin(r *http.Request) string {
	if o := r.Header.Get("Origin"); o != "" {
		return o
	}
	return "http://localhost:5173"
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func ReadJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(dst)
}
func WriteError(w http.ResponseWriter, status int, code, msg string) {
	WriteJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

func (s *Server) user(r *http.Request) (auth.User, auth.Session, bool) {
	u, sess, err := auth.AuthenticateRequest(r)
	if err != nil {
		return u, sess, false
	}
	return u, sess, true
}
func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (auth.User, auth.Session, bool) {
	u, se, ok := s.user(r)
	if !ok {
		WriteError(w, 401, "unauthorized", "sign in required")
	}
	return u, se, ok
}

func (s *Server) handleMagicLink(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	_, _ = auth.CreateMagicLink(r.Context(), req.Email)
	w.WriteHeader(204)
}
func (s *Server) handleConsume(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	sess, u, err := auth.ConsumeMagicLink(r.Context(), req.Token)
	if err != nil {
		WriteError(w, 401, "invalid_token", "token is invalid or expired")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName(), Value: sess.Token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: auth.SessionMaxAge()})
	WriteJSON(w, 200, map[string]any{"user": u})
}
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	WriteJSON(w, 200, u)
}
func (s *Server) handleMePatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req struct {
		Username string `json:"username"`
		Pronouns string `json:"pronouns"`
	}
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	username := strings.TrimSpace(req.Username)
	pronouns := strings.TrimSpace(req.Pronouns)
	if username == "" || pronouns == "" {
		WriteError(w, 400, "profile_required", "name and pronouns are required")
		return
	}
	if len(username) > 80 || len(pronouns) > 40 {
		WriteError(w, 400, "profile_too_long", "name or pronouns are too long")
		return
	}
	row, err := s.oneJSON(r.Context(), `update users set username=$2, pronouns=$3, profile_complete=true, updated_at=now() where id=$1 returning jsonb_build_object('id',id::text,'username',username,'email',email::text,'pronouns',pronouns,'profile_complete',profile_complete)`, u.ID, username, pronouns)
	respondRaw(w, row, err)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	_, sess, ok := s.requireUser(w, r)
	if ok {
		_ = auth.RevokeSession(r.Context(), sess.ID)
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName(), Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	w.WriteHeader(204)
}

// defaultRuleBookID is the built-in D&D book (migration 004); rooms created without a rule book use it.
const defaultRuleBookID = "00000000-0000-4000-8000-000000000005"

// roomJSON renders a rooms row, including the rule book players need for a matching character.
const roomJSON = `jsonb_build_object('id',rooms.id::text,'owner_id',rooms.owner_id::text,'name',rooms.name,'is_public',rooms.is_public,'invite_code',rooms.invite_code,'settings',rooms.settings,'rule_book',(select jsonb_build_object('id',b.id::text,'name',b.name) from rule_books b where b.id=rooms.rule_book_id))`

// ruleBookReadable is a rule_books predicate for the user bound to userParam: owners, editors,
// members of a room playing with the book, and everyone for public books may read and use it.
func ruleBookReadable(userParam string) string {
	return `(rule_books.owner_id=` + userParam + ` or rule_books.is_public or exists(select 1 from rule_book_editors e where e.rule_book_id=rule_books.id and e.user_id=` + userParam + `) or exists(select 1 from rooms r join room_members m on m.room_id=r.id where r.rule_book_id=rule_books.id and m.user_id=` + userParam + `))`
}

func (s *Server) handleRoomsList(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	// Only rooms the caller owns or belongs to, plus public rooms when ?public=true is asked for.
	// Private rooms of other users must never be listed: the response carries their invite code.
	rows, err := s.queryJSON(r.Context(), `select `+roomJSON+` || jsonb_build_object('created_at',created_at) from rooms where ($1 and is_public) or owner_id=$2 or exists(select 1 from room_members where room_id=rooms.id and user_id=$2) order by created_at desc`, r.URL.Query().Get("public") == "true", u.ID)
	respondRows(w, rows, err)
}
func (s *Server) handleRoomsCreate(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req map[string]any
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	name := str(req, "name", "Untitled Room")
	ruleBookID := str(req, "rule_book_id", defaultRuleBookID)
	var usable bool
	if _, err := uuid.Parse(ruleBookID); err == nil {
		if err := s.Pool.QueryRow(r.Context(), `select exists(select 1 from rule_books where id=$1 and `+ruleBookReadable("$2")+`)`, ruleBookID, u.ID).Scan(&usable); err != nil {
			WriteError(w, 500, "db", err.Error())
			return
		}
	}
	if !usable {
		WriteError(w, 400, "invalid_rule_book", "choose a rule book you can use")
		return
	}
	id := uuid.New().String()
	invite := randomCode()
	var ph *string
	if p := str(req, "password", ""); p != "" {
		h := roomPasswordHash(id, p, s.Config.RoomPasswordSalt)
		ph = &h
	}
	isPublic := boolv(req, "is_public", false)
	settings := jsonRaw(req["settings"])
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	err = tx.QueryRow(r.Context(), `insert into rooms(id,owner_id,is_public,password_hash,name,invite_code,settings,rule_book_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning `+roomJSON, id, u.ID, isPublic, ph, name, invite, settings, ruleBookID).Scan(&settings)
	if err == nil {
		_, err = tx.Exec(r.Context(), `insert into room_members(id,room_id,user_id,is_dm) values($1,$2,$3,true)`, uuid.New().String(), id, u.ID)
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	writeRaw(w, 201, settings)
}
func (s *Server) handleRoomGet(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("roomID")
	if err := auth.RequireRoomMember(r.Context(), u.ID, id); err != nil {
		WriteError(w, 403, "forbidden", "room membership required")
		return
	}
	row, err := s.oneJSON(r.Context(), `select `+roomJSON+` from rooms where id=$1`, id)
	respondRaw(w, row, err)
}
func (s *Server) handleRoomPatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("roomID")
	if err := auth.RequireRoomDM(r.Context(), u.ID, id); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	var req map[string]any
	_ = ReadJSON(r, &req)
	row, err := s.oneJSON(r.Context(), `update rooms set name=coalesce($2,name), is_public=coalesce($3,is_public), settings=coalesce($4,settings), updated_at=now() where id=$1 returning `+roomJSON, id, nullableString(req, "name"), nullableBool(req, "is_public"), nullableJSON(req, "settings"))
	respondRaw(w, row, err)
}
func (s *Server) handleRoomJoin(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req struct {
		InviteCode string `json:"invite_code"`
		Password   string `json:"password"`
		SheetID    string `json:"sheet_id"`
	}
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	var roomID string
	var ph *string
	err := s.Pool.QueryRow(r.Context(), `select id::text,password_hash from rooms where invite_code=$1`, req.InviteCode).Scan(&roomID, &ph)
	if err != nil {
		WriteError(w, 404, "not_found", "room not found")
		return
	}
	if ph != nil && *ph != roomPasswordHash(roomID, req.Password, s.Config.RoomPasswordSalt) {
		WriteError(w, 403, "bad_password", "room password is incorrect")
		return
	}
	if req.SheetID != "" {
		valid, err := s.roomSheetAllowed(r.Context(), req.SheetID, roomID, u.ID, false, u.ID)
		if err != nil {
			WriteError(w, 500, "db", err.Error())
			return
		}
		if !valid {
			WriteError(w, 400, "invalid_sheet", "choose a character that uses this room's rule book")
			return
		}
	}
	// Rejoining keeps the current character unless a new one is chosen.
	_, err = s.Pool.Exec(r.Context(), `insert into room_members(id,room_id,user_id,is_dm,sheet_id) values($1,$2,$3,false,$4) on conflict(room_id,user_id) do update set sheet_id=coalesce(excluded.sheet_id,room_members.sheet_id)`, uuid.New().String(), roomID, u.ID, nullableLiteral(req.SheetID))
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	// The invite carries the room's rule book so the client can ask for a matching character.
	row, err := s.oneJSON(r.Context(), `select jsonb_build_object('room_id',r.id::text,'rule_book',jsonb_build_object('id',b.id::text,'name',b.name),'is_dm',m.is_dm,'sheet_id',m.sheet_id::text) from rooms r join rule_books b on b.id=r.rule_book_id join room_members m on m.room_id=r.id and m.user_id=$2 where r.id=$1`, roomID, u.ID)
	respondRaw(w, row, err)
}

// handleInviteGet previews an invite before joining: room name, rule book, whether a password is
// required, and the caller's existing membership (null when not yet a member).
func (s *Server) handleInviteGet(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	row, err := s.oneJSON(r.Context(), `select jsonb_build_object('room_id',r.id::text,'name',r.name,'rule_book',jsonb_build_object('id',b.id::text,'name',b.name),'requires_password',r.password_hash is not null,'member',(select jsonb_build_object('is_dm',m.is_dm,'sheet_id',m.sheet_id::text) from room_members m where m.room_id=r.id and m.user_id=$2)) from rooms r join rule_books b on b.id=r.rule_book_id where r.invite_code=$1`, r.PathValue("code"), u.ID)
	respondRaw(w, row, err)
}

// roomSheetAllowed reports whether sheetID may be the target member's character in the room: it must
// use the room's rule book and belong to the target; a DM actor may also assign their own or public sheets.
func (s *Server) roomSheetAllowed(ctx context.Context, sheetID, roomID, target string, actorIsDM bool, actorID string) (bool, error) {
	if _, err := uuid.Parse(sheetID); err != nil {
		return false, nil
	}
	var valid bool
	err := s.Pool.QueryRow(ctx, `select exists(select 1 from sheets s join rooms r on r.rule_book_id=s.rule_book_id where s.id=$1 and r.id=$2 and (s.user_id=$3 or ($4 and (s.user_id=$5 or s.is_public))))`, sheetID, roomID, target, actorIsDM, actorID).Scan(&valid)
	return valid, err
}

func (s *Server) handleMembers(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomMember(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "room membership required")
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',rm.id::text,'room_id',rm.room_id::text,'user_id',rm.user_id::text,'username',u.username,'pronouns',u.pronouns,'sheet_id',rm.sheet_id::text,'is_dm',rm.is_dm,'joined_at',rm.joined_at) from room_members rm join users u on u.id=rm.user_id where rm.room_id=$1 order by rm.joined_at`, roomID)
	respondRows(w, rows, err)
}

// handleMemberPatch lets the DM assign characters and DM status; players may choose only their own
// character. Assigned sheets must use the room's rule book; a null or empty sheet_id clears it.
func (s *Server) handleMemberPatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	target := r.PathValue("userID")
	var req map[string]any
	_ = ReadJSON(r, &req)
	isDM := s.isDM(r.Context(), u.ID, roomID)
	dmChange := nullableBool(req, "is_dm")
	if !isDM && (target != u.ID || dmChange != nil || auth.RequireRoomMember(r.Context(), u.ID, roomID) != nil) {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	_, setSheet := req["sheet_id"]
	sheetID := nullableString(req, "sheet_id")
	if sheetID != nil {
		valid, err := s.roomSheetAllowed(r.Context(), *sheetID, roomID, target, isDM, u.ID)
		if err != nil {
			WriteError(w, 500, "db", err.Error())
			return
		}
		if !valid {
			WriteError(w, 400, "invalid_sheet", "choose a character that uses this room's rule book")
			return
		}
	}
	row, err := s.oneJSON(r.Context(), `update room_members set sheet_id=case when $5 then $3::uuid else sheet_id end, is_dm=coalesce($4,is_dm) where room_id=$1 and user_id=$2 returning jsonb_build_object('id',id::text,'room_id',room_id::text,'user_id',user_id::text,'sheet_id',sheet_id::text,'is_dm',is_dm)`, roomID, target, sheetID, dmChange, setSheet)
	respondRaw(w, row, err)
}

func (s *Server) handleFriendsList(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',f.id::text,'requester_user_id',f.requester_user_id::text,'addressee_user_id',f.addressee_user_id::text,'status',f.status,'blocked_by_user_id',f.blocked_by_user_id::text,'other_user',jsonb_build_object('id',ou.id::text,'username',ou.username,'email',ou.email::text,'pronouns',ou.pronouns,'profile_complete',ou.profile_complete),'direction',case when f.addressee_user_id=$1 then 'inbound' else 'outbound' end) from friends f join users ou on ou.id=case when f.requester_user_id=$1 then f.addressee_user_id else f.requester_user_id end where f.requester_user_id=$1 or f.addressee_user_id=$1 order by f.updated_at desc`, u.ID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	out := map[string][]json.RawMessage{"pending_inbound": {}, "pending_outbound": {}, "accepted": {}, "blocked": {}}
	for _, row := range rows {
		var m map[string]any
		_ = json.Unmarshal(row, &m)
		switch m["status"] {
		case "accepted":
			out["accepted"] = append(out["accepted"], row)
		case "blocked":
			out["blocked"] = append(out["blocked"], row)
		default:
			if m["direction"] == "inbound" {
				out["pending_inbound"] = append(out["pending_inbound"], row)
			} else {
				out["pending_outbound"] = append(out["pending_outbound"], row)
			}
		}
	}
	WriteJSON(w, 200, out)
}
func (s *Server) handleFriendCreate(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	_ = ReadJSON(r, &req)
	var target string
	err := s.Pool.QueryRow(r.Context(), `select id::text from users where email=$1`, strings.ToLower(strings.TrimSpace(req.Email))).Scan(&target)
	if err != nil {
		WriteError(w, 404, "not_found", "user not found")
		return
	}
	if target == u.ID {
		WriteError(w, 400, "self_request", "cannot friend yourself")
		return
	}
	row, err := s.oneJSON(r.Context(), `insert into friends(id,requester_user_id,addressee_user_id,status) values($1,$2,$3,'pending') returning jsonb_build_object('id',id::text,'requester_user_id',requester_user_id::text,'addressee_user_id',addressee_user_id::text,'status',status)`, uuid.New().String(), u.ID, target)
	if err != nil {
		WriteError(w, 409, "friend_exists", "friendship already exists")
		return
	}
	writeRaw(w, 201, row)
}
func (s *Server) handleFriendPatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("friendID")
	var req struct {
		Status string `json:"status"`
	}
	_ = ReadJSON(r, &req)
	if req.Status == "accepted" {
		row, err := s.oneJSON(r.Context(), `update friends set status='accepted',blocked_by_user_id=null,updated_at=now() where id=$1 and addressee_user_id=$2 and status='pending' returning jsonb_build_object('id',id::text,'status',status)`, id, u.ID)
		respondRaw(w, row, err)
		return
	}
	if req.Status == "blocked" {
		row, err := s.oneJSON(r.Context(), `update friends set status='blocked',blocked_by_user_id=$2,updated_at=now() where id=$1 and (requester_user_id=$2 or addressee_user_id=$2) returning jsonb_build_object('id',id::text,'status',status,'blocked_by_user_id',blocked_by_user_id::text)`, id, u.ID)
		respondRaw(w, row, err)
		return
	}
	WriteError(w, 400, "bad_status", "status must be accepted or blocked")
}
func (s *Server) handleFriendDelete(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	tag, err := s.Pool.Exec(r.Context(), `delete from friends where id=$1 and (requester_user_id=$2 or addressee_user_id=$2)`, r.PathValue("friendID"), u.ID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		WriteError(w, 404, "not_found", "friendship not found")
		return
	}
	w.WriteHeader(204)
}

func (s *Server) handleRuleBooksList(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'attributes',attributes,'creation_rules',creation_rules) from rule_books where `+ruleBookReadable("$1")+` order by owner_id is null desc, created_at desc`, u.ID)
	respondRows(w, rows, err)
}
func (s *Server) handleRuleBookCreate(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req map[string]any
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	attributes, err := requestObject(req, "attributes")
	if err != nil {
		WriteError(w, 400, "invalid_attributes", err.Error())
		return
	}
	rules, err := requestObject(req, "creation_rules")
	if err != nil {
		WriteError(w, 400, "invalid_rules", err.Error())
		return
	}
	rulesJSON := jsonRaw(rules)
	if _, err := parseCreationRules(rulesJSON, attributes); err != nil {
		WriteError(w, 400, "invalid_rules", err.Error())
		return
	}
	row, err := s.oneJSON(r.Context(), `insert into rule_books(id,owner_id,name,is_public,attributes,creation_rules) values($1,$2,$3,$4,$5,$6) returning jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'attributes',attributes,'creation_rules',creation_rules)`, uuid.New().String(), u.ID, str(req, "name", "Untitled Rule Book"), boolv(req, "is_public", false), jsonRaw(attributes), rulesJSON)
	respondRawStatus(w, row, err, 201)
}
func (s *Server) handleRuleBookGet(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("ruleBookID")
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'attributes',attributes,'creation_rules',creation_rules) from rule_books where id=$1 and `+ruleBookReadable("$2"), id, u.ID)
	respondOne(w, rows, err)
}
func (s *Server) handleRuleBookPatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("ruleBookID")
	if err := auth.CanEditRuleBook(r.Context(), u.ID, id); err != nil {
		WriteError(w, 403, "forbidden", "rule book edit permission required")
		return
	}
	var req map[string]any
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		respondRaw(w, nil, err)
		return
	}
	defer tx.Rollback(r.Context())
	var attributes, rules map[string]any
	if err := tx.QueryRow(r.Context(), `select attributes,creation_rules from rule_books where id=$1 for update`, id).Scan(&attributes, &rules); err != nil {
		respondRaw(w, nil, err)
		return
	}
	if _, exists := req["attributes"]; exists {
		attributes, err = requestObject(req, "attributes")
		if err != nil {
			WriteError(w, 400, "invalid_attributes", err.Error())
			return
		}
	}
	if _, exists := req["creation_rules"]; exists {
		rules, err = requestObject(req, "creation_rules")
		if err != nil {
			WriteError(w, 400, "invalid_rules", err.Error())
			return
		}
	}
	rulesJSON := jsonRaw(rules)
	if _, err := parseCreationRules(rulesJSON, attributes); err != nil {
		WriteError(w, 400, "invalid_rules", err.Error())
		return
	}
	var row json.RawMessage
	err = tx.QueryRow(r.Context(), `update rule_books set name=coalesce($2,name),is_public=coalesce($3,is_public),attributes=$4,creation_rules=$5,updated_at=now() where id=$1 returning jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'attributes',attributes,'creation_rules',creation_rules)`, id, nullableString(req, "name"), nullableBool(req, "is_public"), jsonRaw(attributes), rulesJSON).Scan(&row)
	if err == nil {
		err = tx.Commit(r.Context())
	}
	respondRaw(w, row, err)
}
func (s *Server) handleRuleBookEditor(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("ruleBookID")
	if err := auth.CanEditRuleBook(r.Context(), u.ID, id); err != nil {
		WriteError(w, 403, "forbidden", "rule book edit permission required")
		return
	}
	var req struct {
		UserID string `json:"user_id"`
	}
	_ = ReadJSON(r, &req)
	_, err := s.Pool.Exec(r.Context(), `insert into rule_book_editors(rule_book_id,user_id) values($1,$2) on conflict do nothing`, id, req.UserID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	w.WriteHeader(204)
}

func (s *Server) handleSheetsList(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',id::text,'rule_book_id',rule_book_id::text,'user_id',user_id::text,'name',name,'data',data,'is_public',is_public,'creation',creation) from sheets where user_id=$1 or is_public order by created_at desc`, u.ID)
	respondRows(w, rows, err)
}
func (s *Server) handleSheetCreate(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req map[string]any
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	rb := str(req, "rule_book_id", "")
	if _, err := uuid.Parse(rb); err != nil {
		WriteError(w, 400, "invalid_rule_book", "choose a valid rule book")
		return
	}
	data, err := requestObject(req, "data")
	if err != nil {
		WriteError(w, 400, "invalid_data", err.Error())
		return
	}
	creation, err := requestObject(req, "creation")
	if err != nil {
		WriteError(w, 400, "invalid_creation", err.Error())
		return
	}
	var attributes map[string]any
	var rulesJSON json.RawMessage
	err = s.Pool.QueryRow(r.Context(), `select attributes,creation_rules from rule_books where id=$1 and `+ruleBookReadable("$2"), rb, u.ID).Scan(&attributes, &rulesJSON)
	if err != nil {
		respondRaw(w, nil, err)
		return
	}
	rules, err := parseCreationRules(rulesJSON, attributes)
	if err != nil {
		WriteError(w, 400, "invalid_rules", err.Error())
		return
	}
	data, metadata, err := applyCharacterCreation(attributes, rules, data, jsonRaw(creation))
	if err != nil {
		WriteError(w, 400, "invalid_creation", err.Error())
		return
	}
	row, err := s.oneJSON(r.Context(), `insert into sheets(id,rule_book_id,user_id,name,data,is_public,creation) values($1,$2,$3,$4,$5,$6,$7) returning jsonb_build_object('id',id::text,'rule_book_id',rule_book_id::text,'user_id',user_id::text,'name',name,'data',data,'is_public',is_public,'creation',creation)`, uuid.New().String(), rb, u.ID, str(req, "name", "Untitled Sheet"), jsonRaw(data), boolv(req, "is_public", false), jsonRaw(metadata))
	respondRawStatus(w, row, err, 201)
}
func (s *Server) handleSheetGet(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',id::text,'rule_book_id',rule_book_id::text,'user_id',user_id::text,'name',name,'data',data,'is_public',is_public,'creation',creation) from sheets where id=$1 and (user_id=$2 or is_public)`, r.PathValue("sheetID"), u.ID)
	respondOne(w, rows, err)
}
func (s *Server) handleSheetPatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req map[string]any
	_ = ReadJSON(r, &req)
	row, err := s.oneJSON(r.Context(), `update sheets set name=coalesce($3,name),data=coalesce($4,data),is_public=coalesce($5,is_public),updated_at=now() where id=$1 and user_id=$2 returning jsonb_build_object('id',id::text,'rule_book_id',rule_book_id::text,'user_id',user_id::text,'name',name,'data',data,'is_public',is_public,'creation',creation)`, r.PathValue("sheetID"), u.ID, nullableString(req, "name"), nullableJSON(req, "data"), nullableBool(req, "is_public"))
	respondRaw(w, row, err)
}

func (s *Server) handleMapsList(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'width_m',width_m,'height_m',height_m,'grid_size_m',grid_size_m,'background_asset_id',background_asset_id::text) from maps where owner_id=$1 or is_public or exists(select 1 from map_editors where map_id=maps.id and user_id=$1) order by created_at desc`, u.ID)
	respondRows(w, rows, err)
}
func (s *Server) handleMapCreate(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req map[string]any
	_ = ReadJSON(r, &req)
	name := str(req, "name", "")
	if name == "" {
		name = s.nextMapName(r.Context(), u.ID)
	}
	row, err := s.oneJSON(r.Context(), `insert into maps(id,owner_id,name,is_public,width_m,height_m,grid_size_m,background_asset_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'width_m',width_m,'height_m',height_m,'grid_size_m',grid_size_m,'background_asset_id',background_asset_id::text)`, uuid.New().String(), u.ID, name, boolv(req, "is_public", false), floatv(req, "width_m", 30), floatv(req, "height_m", 30), floatv(req, "grid_size_m", 1), nullableString(req, "background_asset_id"))
	respondRawStatus(w, row, err, 201)
}
func (s *Server) handleMapGet(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("mapID")
	rows, err := s.queryJSON(r.Context(), `select jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'width_m',width_m,'height_m',height_m,'grid_size_m',grid_size_m,'background_asset_id',background_asset_id::text,'structures',coalesce((select jsonb_agg(jsonb_build_object('id',ms.id::text,'map_id',ms.map_id::text,'kind',ms.kind,'geometry',ms.geometry,'blocks_vision',ms.blocks_vision,'blocks_movement',ms.blocks_movement,'blocks_attacks',ms.blocks_attacks,'cover_bonus',ms.cover_bonus,'pass_rules',ms.pass_rules)) from map_structures ms where ms.map_id=maps.id and ms.room_map_id is null),'[]'::jsonb)) from maps where id=$1 and (owner_id=$2 or is_public or exists(select 1 from map_editors where map_id=$1 and user_id=$2))`, id, u.ID)
	respondOne(w, rows, err)
}
func (s *Server) handleMapPatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("mapID")
	if err := auth.CanEditMap(r.Context(), u.ID, id); err != nil {
		WriteError(w, 403, "forbidden", "map edit permission required")
		return
	}
	var req map[string]any
	_ = ReadJSON(r, &req)
	row, err := s.oneJSON(r.Context(), `update maps set name=coalesce($2,name),is_public=coalesce($3,is_public),width_m=coalesce($4,width_m),height_m=coalesce($5,height_m),grid_size_m=coalesce($6,grid_size_m),background_asset_id=coalesce($7,background_asset_id),updated_at=now() where id=$1 returning jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'is_public',is_public,'width_m',width_m,'height_m',height_m,'grid_size_m',grid_size_m,'background_asset_id',background_asset_id::text)`, id, nullableString(req, "name"), nullableBool(req, "is_public"), nullableFloat(req, "width_m"), nullableFloat(req, "height_m"), nullableFloat(req, "grid_size_m"), nullableString(req, "background_asset_id"))
	respondRaw(w, row, err)
	s.bumpMapRooms(context.Background(), id)
}
func (s *Server) handleMapEditor(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("mapID")
	if err := auth.CanEditMap(r.Context(), u.ID, id); err != nil {
		WriteError(w, 403, "forbidden", "map edit permission required")
		return
	}
	var req struct {
		UserID string `json:"user_id"`
	}
	_ = ReadJSON(r, &req)
	_, err := s.Pool.Exec(r.Context(), `insert into map_editors(map_id,user_id) values($1,$2) on conflict do nothing`, id, req.UserID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	w.WriteHeader(204)
}

func (s *Server) handleStructureCreate(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	mapID := r.PathValue("mapID")
	if err := auth.CanEditMap(r.Context(), u.ID, mapID); err != nil {
		WriteError(w, 403, "forbidden", "map edit permission required")
		return
	}
	var req map[string]any
	_ = ReadJSON(r, &req)
	row, err := s.oneJSON(r.Context(), `insert into map_structures(id,map_id,kind,geometry,blocks_vision,blocks_movement,blocks_attacks,cover_bonus,pass_rules) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning jsonb_build_object('id',id::text,'map_id',map_id::text,'kind',kind,'geometry',geometry,'blocks_vision',blocks_vision,'blocks_movement',blocks_movement,'blocks_attacks',blocks_attacks,'cover_bonus',cover_bonus,'pass_rules',pass_rules)`, uuid.New().String(), mapID, str(req, "kind", "wall"), jsonRaw(req["geometry"]), boolv(req, "blocks_vision", false), boolv(req, "blocks_movement", false), boolv(req, "blocks_attacks", false), intv(req, "cover_bonus", 0), jsonRaw(req["pass_rules"]))
	respondRawStatus(w, row, err, 201)
	s.bumpMapRooms(context.Background(), mapID)
}
func (s *Server) handleStructurePatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	mapID := r.PathValue("mapID")
	if err := auth.CanEditMap(r.Context(), u.ID, mapID); err != nil {
		WriteError(w, 403, "forbidden", "map edit permission required")
		return
	}
	var req map[string]any
	_ = ReadJSON(r, &req)
	row, err := s.oneJSON(r.Context(), `update map_structures set kind=coalesce($3,kind),geometry=coalesce($4,geometry),blocks_vision=coalesce($5,blocks_vision),blocks_movement=coalesce($6,blocks_movement),blocks_attacks=coalesce($7,blocks_attacks),cover_bonus=coalesce($8,cover_bonus),pass_rules=coalesce($9,pass_rules) where id=$1 and map_id=$2 and room_map_id is null returning jsonb_build_object('id',id::text,'map_id',map_id::text,'kind',kind,'geometry',geometry,'blocks_vision',blocks_vision,'blocks_movement',blocks_movement,'blocks_attacks',blocks_attacks,'cover_bonus',cover_bonus,'pass_rules',pass_rules)`, r.PathValue("structureID"), mapID, nullableString(req, "kind"), nullableJSON(req, "geometry"), nullableBool(req, "blocks_vision"), nullableBool(req, "blocks_movement"), nullableBool(req, "blocks_attacks"), nullableInt(req, "cover_bonus"), nullableJSON(req, "pass_rules"))
	respondRaw(w, row, err)
	s.bumpMapRooms(context.Background(), mapID)
}
func (s *Server) handleStructureDelete(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	mapID := r.PathValue("mapID")
	if err := auth.CanEditMap(r.Context(), u.ID, mapID); err != nil {
		WriteError(w, 403, "forbidden", "map edit permission required")
		return
	}
	_, err := s.Pool.Exec(r.Context(), `delete from map_structures where id=$1 and map_id=$2 and room_map_id is null`, r.PathValue("structureID"), mapID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	s.bumpMapRooms(context.Background(), mapID)
	w.WriteHeader(204)
}

func (s *Server) handleAssetUpload(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		WriteError(w, 400, "multipart", "invalid multipart form")
		return
	}
	f, h, err := r.FormFile("file")
	if err != nil {
		WriteError(w, 400, "file_required", "file field is required")
		return
	}
	defer f.Close()
	id := uuid.New().String()
	path, size, err := s.Assets.Save(id, f)
	if err != nil {
		WriteError(w, 500, "storage", err.Error())
		return
	}
	mime := h.Header.Get("Content-Type")
	if mime == "" {
		mime = "application/octet-stream"
	}
	row, err := s.oneJSON(r.Context(), `insert into assets(id,owner_id,name,kind,mime_type,byte_size,storage_path,is_public) values($1,$2,$3,$4,$5,$6,$7,$8) returning jsonb_build_object('id',id::text,'owner_id',owner_id::text,'name',name,'kind',kind,'mime_type',mime_type,'byte_size',byte_size,'storage_path',storage_path,'is_public',is_public)`, id, u.ID, form(r.MultipartForm, "name", h.Filename), form(r.MultipartForm, "kind", "site"), mime, size, path, form(r.MultipartForm, "is_public", "") == "true")
	respondRawStatus(w, row, err, 201)
}

func (s *Server) handleRoomMapAttach(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomDM(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	var req struct {
		MapID    string `json:"map_id"`
		IsActive bool   `json:"is_active"`
	}
	_ = ReadJSON(r, &req)
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if req.IsActive {
		_, _ = tx.Exec(r.Context(), `update room_maps set is_active=false where room_id=$1`, roomID)
	}
	var row json.RawMessage
	err = tx.QueryRow(r.Context(), `insert into room_maps(id,room_id,map_id,is_active) values($1,$2,$3,$4) on conflict(room_id,map_id) do update set is_active=excluded.is_active returning jsonb_build_object('id',id::text,'room_id',room_id::text,'map_id',map_id::text,'is_active',is_active)`, uuid.New().String(), roomID, req.MapID, req.IsActive).Scan(&row)
	if err == nil {
		err = tx.Commit(r.Context())
	}
	respondRawStatus(w, row, err, 201)
	if err == nil {
		s.bumpRoom(context.Background(), roomID)
		s.Hub.PublishMapActivated(roomID, req.MapID)
	}
}

// handleRoomMapNew starts a blank map in the DM's library and makes it this room's active map.
func (s *Server) handleRoomMapNew(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomDM(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	var req map[string]any
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	def := ws.DefaultMapSpec
	spec := ws.MapSpec{Name: strings.TrimSpace(str(req, "name", "")), WidthM: floatv(req, "width_m", def.WidthM), HeightM: floatv(req, "height_m", def.HeightM), GridSizeM: floatv(req, "grid_size_m", def.GridSizeM)}
	row, err := s.Hub.CreateBlankRoomMap(r.Context(), roomID, u.ID, spec)
	if errors.Is(err, ws.ErrInvalidMapSpec) {
		WriteError(w, 400, "invalid_map", err.Error())
		return
	}
	respondRawStatus(w, row, err, 201)
}
func (s *Server) handleRoomMapPatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomDM(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "DM required")
		return
	}
	var req struct {
		IsActive bool `json:"is_active"`
	}
	_ = ReadJSON(r, &req)
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if req.IsActive {
		_, _ = tx.Exec(r.Context(), `update room_maps set is_active=false where room_id=$1`, roomID)
	}
	var row json.RawMessage
	err = tx.QueryRow(r.Context(), `update room_maps set is_active=$3 where id=$1 and room_id=$2 returning jsonb_build_object('id',id::text,'room_id',room_id::text,'map_id',map_id::text,'is_active',is_active)`, r.PathValue("roomMapID"), roomID, req.IsActive).Scan(&row)
	if err == nil {
		err = tx.Commit(r.Context())
	}
	respondRaw(w, row, err)
	if err == nil {
		var activated struct {
			MapID string `json:"map_id"`
		}
		_ = json.Unmarshal(row, &activated)
		s.bumpRoom(context.Background(), roomID)
		s.Hub.PublishMapActivated(roomID, activated.MapID)
	}
}

func (s *Server) handleRoomState(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomMember(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "room membership required")
		return
	}
	st, err := s.visibleState(r.Context(), roomID, u.ID)
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	WriteJSON(w, 200, st)
}
func (s *Server) handleTokenCreate(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID := r.PathValue("roomID")
	if err := auth.RequireRoomMember(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "room membership required")
		return
	}
	var req map[string]any
	_ = ReadJSON(r, &req)
	isDM := s.isDM(r.Context(), u.ID, roomID)
	sheet := str(req, "sheet_id", "")
	if !isDM {
		if sheet == "" {
			WriteError(w, 400, "sheet_required", "players must use one of their character sheets")
			return
		}
		var owns bool
		_ = s.Pool.QueryRow(r.Context(), `select exists(select 1 from sheets s join rooms r on r.rule_book_id=s.rule_book_id where s.id=$1 and s.user_id=$2 and r.id=$3)`, sheet, u.ID, roomID).Scan(&owns)
		if !owns {
			WriteError(w, 403, "forbidden", "players may create only their own sheet token for this room's rule book")
			return
		}
	}
	var roomMapID string
	if err := s.Pool.QueryRow(r.Context(), `select id::text from room_maps where room_id=$1 and is_active`, roomID).Scan(&roomMapID); err != nil {
		WriteError(w, 400, "no_active_map", "room has no active map")
		return
	}
	row, err := s.oneJSON(r.Context(), `insert into room_tokens(id,room_map_id,sheet_id,owner_user_id,name,x_m,y_m,rotation_deg,size_m,vision_range_m,vision_angle_deg,is_hidden,attributes) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning jsonb_build_object('id',id::text,'room_map_id',room_map_id::text,'sheet_id',sheet_id::text,'owner_user_id',owner_user_id::text,'name',name,'x_m',x_m,'y_m',y_m,'rotation_deg',rotation_deg,'size_m',size_m,'vision_range_m',vision_range_m,'vision_angle_deg',vision_angle_deg,'is_hidden',is_hidden,'attributes',attributes)`, uuid.New().String(), roomMapID, nullableLiteral(sheet), u.ID, str(req, "name", "Token"), floatv(req, "x_m", 1), floatv(req, "y_m", 1), floatv(req, "rotation_deg", 0), floatv(req, "size_m", 1), floatv(req, "vision_range_m", 12), floatv(req, "vision_angle_deg", 90), boolv(req, "is_hidden", false), jsonRaw(req["attributes"]))
	respondRawStatus(w, row, err, 201)
	s.bumpRoom(context.Background(), roomID)
}

func (s *Server) handleTokenAttacksPatch(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	roomID, tokenID := r.PathValue("roomID"), r.PathValue("tokenID")
	if err := auth.RequireRoomMember(r.Context(), u.ID, roomID); err != nil {
		WriteError(w, 403, "forbidden", "room membership required")
		return
	}
	if _, err := uuid.Parse(tokenID); err != nil {
		WriteError(w, 404, "not_found", "token not found")
		return
	}
	token, err := s.loadToken(r.Context(), roomID, tokenID)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "token not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if !token.CanEditAttacks(u.ID, s.isDM(r.Context(), u.ID, roomID)) {
		WriteError(w, 403, "forbidden", "only the character's owner, or the game master for tokens without a sheet, can edit attacks")
		return
	}
	var req struct {
		Attacks json.RawMessage `json:"attacks"`
	}
	if err := ReadJSON(r, &req); err != nil {
		WriteError(w, 400, "bad_json", "invalid JSON")
		return
	}
	if req.Attacks == nil {
		WriteError(w, 400, "invalid_attacks", "attacks is required")
		return
	}
	attacks, err := game.ParseAttacks(req.Attacks)
	if err != nil {
		WriteError(w, 400, "invalid_attacks", err.Error())
		return
	}
	encoded, err := json.Marshal(attacks)
	if err != nil {
		WriteError(w, 500, "encode", err.Error())
		return
	}
	if token.SheetID != "" {
		_, err = s.Pool.Exec(r.Context(), `update sheets set data=jsonb_set(data,'{attacks}',$2),updated_at=now() where id=$1`, token.SheetID, json.RawMessage(encoded))
	} else {
		_, err = s.Pool.Exec(r.Context(), `update room_tokens set attributes=jsonb_set(attributes,'{attacks}',$2),updated_at=now() where id=$1`, tokenID, json.RawMessage(encoded))
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	s.bumpRoom(r.Context(), roomID)
	s.Hub.PublishTokenUpdated(roomID, tokenID)
	WriteJSON(w, 200, map[string]any{"attacks": game.ResolveAttacks(attacks, token.Stats)})
}

func (s *Server) visibleState(ctx context.Context, roomID, userID string) (map[string]any, error) {
	room, err := s.oneJSON(ctx, `select `+roomJSON+` from rooms where id=$1`, roomID)
	if err != nil {
		return nil, err
	}
	active, err := s.oneJSON(ctx, `select jsonb_build_object('id',rm.id::text,'room_id',rm.room_id::text,'map_id',m.id::text,'name',m.name,'width_m',m.width_m,'height_m',m.height_m,'grid_size_m',m.grid_size_m,'background_asset_id',m.background_asset_id::text) from room_maps rm join maps m on m.id=rm.map_id where rm.room_id=$1 and rm.is_active`, roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		active = []byte(`null`)
		err = nil
	}
	if err != nil {
		return nil, err
	}
	isDM := s.isDM(ctx, userID, roomID)
	structures, _ := s.loadStructures(ctx, roomID)
	tokens, _ := s.loadTokens(ctx, roomID)
	width, height := 30.0, 30.0
	var amap map[string]any
	_ = json.Unmarshal(active, &amap)
	if amap != nil {
		width = toFloat(amap["width_m"])
		height = toFloat(amap["height_m"])
	}
	vis := game.ComputeVisibility(game.VisibilityInput{IsDM: isDM, UserID: userID, MapWidthM: width, MapHeightM: height, Tokens: tokens, Structures: structures})
	visibleStructIDs := set(vis.VisibleStructureIDs)
	visibleTokIDs := set(vis.VisibleTokenIDs)
	structRows := []game.Structure{}
	for _, st := range structures {
		if isDM || visibleStructIDs[st.ID] {
			structRows = append(structRows, st)
		}
	}
	tokRows := []game.Token{}
	own := []game.Token{}
	for _, t := range tokens {
		if isDM || t.OwnerUserID == userID {
			if attacks, err := t.AttackList(); err == nil {
				t.Attacks = game.ResolveAttacks(attacks, t.Stats)
			}
			t.AttacksEditable = t.CanEditAttacks(userID, isDM)
		}
		// Raw NPC attacks never reach other viewers through attributes.
		delete(t.Attributes, "attacks")
		if t.OwnerUserID == userID {
			own = append(own, t)
		}
		if isDM || visibleTokIDs[t.ID] {
			tokRows = append(tokRows, t)
		}
	}
	chat, err := s.queryJSON(ctx, `select jsonb_build_object('id',cm.id::text,'room_id',cm.room_id::text,'sender_user_id',cm.sender_user_id::text,'kind',cm.kind,'body',cm.body,'roll',cm.roll,'created_at',cm.created_at,'recipient_user_ids',coalesce((select jsonb_agg(user_id::text) from chat_message_recipients where message_id=cm.id),'[]'::jsonb)) from chat_messages cm where cm.room_id=$1 and (not exists(select 1 from chat_message_recipients r where r.message_id=cm.id) or cm.sender_user_id=$2 or exists(select 1 from room_members rm where rm.room_id=$1 and rm.user_id=$2 and rm.is_dm) or exists(select 1 from chat_message_recipients r where r.message_id=cm.id and r.user_id=$2)) order by cm.created_at limit 200`, roomID, userID)
	if err != nil {
		return nil, err
	}
	checks, err := s.visibleChecks(ctx, roomID, userID, isDM)
	if err != nil {
		return nil, err
	}
	return map[string]any{"room": json.RawMessage(room), "activeMap": json.RawMessage(active), "structures": structRows, "visibleTokens": tokRows, "ownTokens": own, "chatHistory": chat, "checks": checks, "metersPerGrid": gridFromRaw(active), "visibility": vis}, nil
}

// visibleChecks lists open checks and the most recent closed ones, newest first. Game masters
// see every check and result. Others see public checks in full, and of a private check only
// the ones they were asked to roll, with only their own result.
func (s *Server) visibleChecks(ctx context.Context, roomID, userID string, isDM bool) ([]map[string]any, error) {
	raw, err := s.queryJSON(ctx, `select jsonb_build_object('id',c.id::text,'title',c.title,'kind',c.check_kind,'key',c.check_key,'dc',c.dc,'is_private',c.is_private,'created_by',c.created_by::text,'created_at',c.created_at,'closed_at',c.closed_at,
		'targets',coalesce((select jsonb_agg(jsonb_build_object('user_id',t.user_id::text,'roll',t.roll,'success',t.success,'rolled_at',t.rolled_at) order by u.username) from room_check_targets t join users u on u.id=t.user_id where t.check_id=c.id and ($3 or not c.is_private or t.user_id=$2)),'[]'::jsonb))
		from room_checks c where c.room_id=$1 and ($3 or not c.is_private or exists(select 1 from room_check_targets t where t.check_id=c.id and t.user_id=$2))
		order by c.closed_at is null desc, coalesce(c.closed_at,c.created_at) desc limit 20`, roomID, userID, isDM)
	if err != nil {
		return nil, err
	}
	checks := []map[string]any{}
	for _, item := range raw {
		var check map[string]any
		if err := json.Unmarshal(item, &check); err != nil {
			return nil, err
		}
		kind, _ := check["kind"].(string)
		key, _ := check["key"].(string)
		check["label"] = game.Check{Kind: kind, Key: key}.Label()
		checks = append(checks, check)
	}
	return checks, nil
}

func (s *Server) loadStructures(ctx context.Context, roomID string) ([]game.Structure, error) {
	rows, err := s.Pool.Query(ctx, `select ms.id::text,ms.kind,coalesce(rmss.geometry,ms.geometry),ms.blocks_vision,ms.blocks_movement,ms.blocks_attacks,ms.cover_bonus,ms.pass_rules,coalesce(rmss.is_hidden,false) from map_structures ms join room_maps rm on rm.map_id=ms.map_id left join room_map_structure_states rmss on rmss.room_map_id=rm.id and rmss.structure_id=ms.id where rm.room_id=$1 and rm.is_active and (ms.room_map_id is null or ms.room_map_id=rm.id) and not coalesce(rmss.is_removed,false)`, roomID)
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
const tokenSelectSQL = `select rt.id::text,coalesce(rt.owner_user_id::text,''),rt.name,rt.x_m::float8,rt.y_m::float8,rt.rotation_deg::float8,rt.size_m::float8,rt.vision_range_m::float8,rt.vision_angle_deg::float8,rt.is_hidden,rt.attributes,coalesce(rt.sheet_id::text,''),coalesce(s.user_id::text,''),coalesce(s.data,rt.attributes) from room_tokens rt join room_maps rm on rm.id=rt.room_map_id left join sheets s on s.id=rt.sheet_id`

func scanToken(row pgx.Row) (game.Token, error) {
	var t game.Token
	var attrs, stats []byte
	if err := row.Scan(&t.ID, &t.OwnerUserID, &t.Name, &t.X, &t.Y, &t.RotationDeg, &t.SizeM, &t.VisionRangeM, &t.VisionAngleDeg, &t.IsHidden, &attrs, &t.SheetID, &t.SheetOwnerUserID, &stats); err != nil {
		return t, err
	}
	// Separate decodes keep Attributes and Stats unaliased for sheetless tokens.
	_ = json.Unmarshal(attrs, &t.Attributes)
	_ = json.Unmarshal(stats, &t.Stats)
	return t, nil
}
func (s *Server) loadTokens(ctx context.Context, roomID string) ([]game.Token, error) {
	rows, err := s.Pool.Query(ctx, tokenSelectSQL+` where rm.room_id=$1 and rm.is_active`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []game.Token
	for rows.Next() {
		t, err := scanToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Server) loadToken(ctx context.Context, roomID, tokenID string) (game.Token, error) {
	return scanToken(s.Pool.QueryRow(ctx, tokenSelectSQL+` where rm.room_id=$1 and rt.id=$2`, roomID, tokenID))
}

func (s *Server) isDM(ctx context.Context, userID, roomID string) bool {
	var ok bool
	_ = s.Pool.QueryRow(ctx, `select exists(select 1 from room_members where room_id=$1 and user_id=$2 and is_dm)`, roomID, userID).Scan(&ok)
	return ok
}
func (s *Server) nextMapName(ctx context.Context, owner string) string {
	var n int
	_ = s.Pool.QueryRow(ctx, `select count(*)+1 from maps where owner_id=$1 and name like 'Untitled Map %'`, owner).Scan(&n)
	return fmt.Sprintf("Untitled Map %d", n)
}
func (s *Server) bumpRoom(ctx context.Context, roomID string) {
	if s.Redis != nil {
		s.Redis.Incr(ctx, "room:"+roomID+":version")
	}
}
func (s *Server) bumpMapRooms(ctx context.Context, mapID string) {
	rows, err := s.Pool.Query(ctx, `select room_id::text from room_maps where map_id=$1`, mapID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		s.bumpRoom(ctx, id)
	}
}

func (s *Server) queryJSON(ctx context.Context, sql string, args ...any) ([]json.RawMessage, error) {
	rows, err := s.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []json.RawMessage
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		out = append(out, raw)
	}
	return out, rows.Err()
}
func (s *Server) oneJSON(ctx context.Context, sql string, args ...any) (json.RawMessage, error) {
	var raw json.RawMessage
	err := s.Pool.QueryRow(ctx, sql, args...).Scan(&raw)
	return raw, err
}
func respondRows(w http.ResponseWriter, rows []json.RawMessage, err error) {
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	WriteJSON(w, 200, rows)
}
func respondOne(w http.ResponseWriter, rows []json.RawMessage, err error) {
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if len(rows) == 0 {
		WriteError(w, 404, "not_found", "not found")
		return
	}
	writeRaw(w, 200, rows[0])
}
func respondRaw(w http.ResponseWriter, raw json.RawMessage, err error) {
	respondRawStatus(w, raw, err, 200)
}
func respondRawStatus(w http.ResponseWriter, raw json.RawMessage, err error, status int) {
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	writeRaw(w, status, raw)
}
func writeRaw(w http.ResponseWriter, status int, raw json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func str(m map[string]any, k, d string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return d
}
func boolv(m map[string]any, k string, d bool) bool {
	if v, ok := m[k].(bool); ok {
		return v
	}
	return d
}
func floatv(m map[string]any, k string, d float64) float64 {
	if v, ok := m[k].(float64); ok {
		return v
	}
	return d
}
func intv(m map[string]any, k string, d int) int {
	if v, ok := m[k].(float64); ok {
		return int(v)
	}
	return d
}
func nullableString(m map[string]any, k string) *string {
	if v, ok := m[k].(string); ok && v != "" {
		return &v
	}
	return nil
}
func nullableLiteral(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}
func nullableBool(m map[string]any, k string) *bool {
	if v, ok := m[k].(bool); ok {
		return &v
	}
	return nil
}
func nullableFloat(m map[string]any, k string) *float64 {
	if v, ok := m[k].(float64); ok {
		return &v
	}
	return nil
}
func nullableInt(m map[string]any, k string) *int {
	if v, ok := m[k].(float64); ok {
		iv := int(v)
		return &iv
	}
	return nil
}
func nullableJSON(m map[string]any, k string) any {
	if v, ok := m[k]; ok {
		return jsonRaw(v)
	}
	return nil
}
func jsonRaw(v any) json.RawMessage {
	if v == nil {
		return json.RawMessage(`{}`)
	}
	b, _ := json.Marshal(v)
	return b
}
func form(f *multipart.Form, k, d string) string {
	if f != nil && len(f.Value[k]) > 0 {
		return f.Value[k][0]
	}
	return d
}
func roomPasswordHash(roomID, pw, salt string) string {
	sum := sha256.Sum256([]byte(roomID + ":" + pw + ":" + salt))
	return hex.EncodeToString(sum[:])
}
func randomCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = chars[rand.IntN(len(chars))]
	}
	return string(b)
}
func set(xs []string) map[string]bool {
	m := map[string]bool{}
	for _, x := range xs {
		m[x] = true
	}
	return m
}
func toFloat(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	default:
		return 0
	}
}
func gridFromRaw(raw []byte) float64 {
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	g := toFloat(m["grid_size_m"])
	if g == 0 {
		return 1
	}
	return g
}
