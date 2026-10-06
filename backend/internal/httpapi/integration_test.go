package httpapi_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"rollandplay/backend/internal/auth"
	"rollandplay/backend/internal/config"
	"rollandplay/backend/internal/db"
	"rollandplay/backend/internal/httpapi"
	"rollandplay/backend/migrations"
)

type testApp struct {
	server  *httptest.Server
	poolURL string
	pool    *pgxpool.Pool
	redis   *redis.Client
	cfg     config.Config
}

func newTestApp(t *testing.T) *testApp {
	t.Helper()
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("DATABASE_URL") == "" || os.Getenv("REDIS_ADDR") == "" {
		t.Skip("DATABASE_URL and REDIS_ADDR required")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.ApplyMigrations(ctx, pool, migrations.Files); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `truncate room_check_targets, room_checks, chat_message_recipients, chat_messages, room_tokens, room_maps, map_structures, map_editors, maps, assets, room_members, rooms, sheets, rule_book_editors, rule_books, friends, sessions, auth_magic_links, users cascade`)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"004_default_dnd_rule_book.sql", "005_character_creation_rules.sql", "009_rule_book_monsters.sql", "012_key_order.sql", "014_rule_book_compendium.sql"} {
		seed, err := migrations.Files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(seed)); err != nil {
			t.Fatal(err)
		}
	}
	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr, Password: cfg.RedisPassword})
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.FlushDB(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	auth.Init(pool, rdb, cfg)
	cfg.AssetStorageDir = t.TempDir()
	api, err := httpapi.New(pool, rdb, cfg)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(api.Handler())
	t.Cleanup(func() { srv.Close(); rdb.Close(); pool.Close() })
	return &testApp{server: srv, pool: pool, redis: rdb, cfg: cfg}
}
func (a *testApp) client(t *testing.T) *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar}
}
func post[T any](t *testing.T, c *http.Client, base, path string, body any) T {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", base+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		t.Fatalf("POST %s status %d", path, res.StatusCode)
	}
	var out T
	if res.StatusCode != 204 {
		_ = json.NewDecoder(res.Body).Decode(&out)
	}
	return out
}
func patch[T any](t *testing.T, c *http.Client, base, path string, body any) T {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("PATCH", base+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		t.Fatalf("PATCH %s status %d", path, res.StatusCode)
	}
	var out T
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out
}
func get[T any](t *testing.T, c *http.Client, base, path string) T {
	t.Helper()
	res, err := c.Get(base + path)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		t.Fatalf("GET %s status %d", path, res.StatusCode)
	}
	var out T
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out
}
func login(t *testing.T, a *testApp, email string) (*http.Client, map[string]any) {
	t.Helper()
	c := a.client(t)
	post[any](t, c, a.server.URL, "/api/auth/magic-link", map[string]string{"email": email})
	msgs, err := a.redis.XRevRangeN(context.Background(), "email_jobs", "+", "-", 1).Result()
	if err != nil || len(msgs) == 0 {
		t.Fatalf("email job: %v len=%d", err, len(msgs))
	}
	rawURL := msgs[0].Values["url"].(string)
	u, _ := url.Parse(rawURL)
	token := u.Query().Get("token")
	got := post[map[string]any](t, c, a.server.URL, "/api/auth/consume", map[string]string{"token": token})
	return c, got["user"].(map[string]any)
}

func TestDefaultRuleBookSharedImmutableAndIdempotent(t *testing.T) {
	a := newTestApp(t)
	first, firstUser := login(t, a, "default-first@example.com")
	second, secondUser := login(t, a, "default-second@example.com")
	const defaultID = "00000000-0000-4000-8000-000000000005"
	custom := post[map[string]any](t, first, a.server.URL, "/api/rule-books", map[string]any{"name": "Custom", "is_public": true})

	ctx := context.Background()
	pool, err := db.Connect(ctx, a.cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	seed, err := migrations.Files.ReadFile("004_default_dnd_rule_book.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := db.ApplyMigrations(ctx, pool, migrations.Files); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(seed)); err != nil {
			t.Fatal(err)
		}
	}

	for _, client := range []*http.Client{first, second} {
		books := get[[]map[string]any](t, client, a.server.URL, "/api/rule-books")
		if len(books) != 2 || books[0]["id"] != defaultID || books[1]["id"] != custom["id"] {
			t.Fatalf("expected one default before custom book, got %#v", books)
		}
		book := get[map[string]any](t, client, a.server.URL, "/api/rule-books/"+defaultID)
		if book["name"] != "D&D 5e (2014)" || book["owner_id"] != nil || book["is_public"] != true {
			t.Fatalf("unexpected default rule book: %#v", book)
		}
		for _, attempt := range []struct {
			method string
			path   string
			body   map[string]any
		}{
			{http.MethodPatch, "/api/rule-books/" + defaultID, map[string]any{"name": "Changed", "is_public": false, "attributes": map[string]any{}}},
			{http.MethodPost, "/api/rule-books/" + defaultID + "/editors", map[string]any{"user_id": firstUser["id"]}},
			{http.MethodPost, "/api/rule-books/" + defaultID + "/editors", map[string]any{"user_id": secondUser["id"]}},
		} {
			body, err := json.Marshal(attempt.body)
			if err != nil {
				t.Fatal(err)
			}
			req, err := http.NewRequest(attempt.method, a.server.URL+attempt.path, bytes.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Content-Type", "application/json")
			res, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != http.StatusForbidden {
				t.Fatalf("%s %s: expected forbidden, got %d", attempt.method, attempt.path, res.StatusCode)
			}
		}
		unchanged := get[map[string]any](t, client, a.server.URL, "/api/rule-books/"+defaultID)
		if !reflect.DeepEqual(unchanged, book) {
			t.Fatalf("default changed after denied edits: %#v", unchanged)
		}
	}
	storedCustom := get[map[string]any](t, first, a.server.URL, "/api/rule-books/"+custom["id"].(string))
	if !reflect.DeepEqual(storedCustom, custom) {
		t.Fatalf("migration changed custom rule book: %#v", storedCustom)
	}
	updated := patch[map[string]any](t, first, a.server.URL, "/api/rule-books/"+custom["id"].(string), map[string]any{"name": "Updated custom"})
	if updated["name"] != "Updated custom" || updated["owner_id"] != firstUser["id"] {
		t.Fatalf("custom owner could not edit their book: %#v", updated)
	}
}

func TestDefaultRuleBookCharacterCreation(t *testing.T) {
	a := newTestApp(t)
	client, _ := login(t, a, "default-sheets@example.com")
	const defaultID = "00000000-0000-4000-8000-000000000005"
	book := get[map[string]any](t, client, a.server.URL, "/api/rule-books/"+defaultID)
	creation := map[string]any{
		"class_id": "fighter",
		"scores":   map[string]any{"strength": 15, "dexterity": 14, "constitution": 13, "intelligence": 12, "wisdom": 10, "charisma": 8},
		"choices":  map[string]any{"skill_proficiencies": []string{"athletics", "perception"}},
	}
	sheet := post[map[string]any](t, client, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": defaultID, "creation": creation, "data": map[string]any{"speed_m": 0, "inspiration": false, "notes": "Custom hero"}})
	data := sheet["data"].(map[string]any)
	skills := data["skill_proficiencies"].(map[string]any)
	saves := data["saving_throw_proficiencies"].(map[string]any)
	if data["class"] != "Fighter" || data["hit_die"] != float64(10) || data["strength"] != float64(15) || data["speed_m"] != float64(0) || data["inspiration"] != false || data["notes"] != "Custom hero" || skills["athletics"] != true || skills["arcana"] != false || saves["constitution"] != true || saves["wisdom"] != false {
		t.Fatalf("class/point defaults were not applied: %#v", data)
	}
	stored := get[map[string]any](t, client, a.server.URL, "/api/sheets/"+sheet["id"].(string))
	if !reflect.DeepEqual(stored, sheet) {
		t.Fatalf("created character did not round trip: %#v", stored)
	}
	if !reflect.DeepEqual(get[map[string]any](t, client, a.server.URL, "/api/rule-books/"+defaultID), book) {
		t.Fatal("creating a character changed the source rule book")
	}
	// Progression remains possible; initial allocation is a creation-time contract.
	updated := patch[map[string]any](t, client, a.server.URL, "/api/sheets/"+sheet["id"].(string), map[string]any{"data": map[string]any{"strength": 20}})
	if updated["data"].(map[string]any)["strength"] != float64(20) || !reflect.DeepEqual(updated["creation"], stored["creation"]) {
		t.Fatal("progression changed creation provenance")
	}
}

func TestCustomRuleBookSheetDefaults(t *testing.T) {
	a := newTestApp(t)
	client, _ := login(t, a, "custom-sheets@example.com")
	for _, tc := range []struct {
		name       string
		attributes map[string]any
		data       map[string]any
		expected   map[string]any
	}{
		{"empty defaults", map[string]any{}, map[string]any{"score": 7, "active": false}, map[string]any{"score": float64(7), "active": false}},
		{"custom defaults", map[string]any{"score": 8, "active": true, "label": "Hero", "details": map[string]any{"a": 1, "b": 2}}, map[string]any{"score": 0, "active": false, "details": map[string]any{"c": 3}}, map[string]any{"score": float64(0), "active": false, "label": "Hero", "details": map[string]any{"c": float64(3)}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			book := post[map[string]any](t, client, a.server.URL, "/api/rule-books", map[string]any{"name": tc.name, "attributes": tc.attributes})
			sheet := post[map[string]any](t, client, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": book["id"], "data": tc.data})
			if !reflect.DeepEqual(sheet["data"], tc.expected) {
				t.Fatalf("custom sheet data: got %#v, want %#v", sheet["data"], tc.expected)
			}
			stored := get[map[string]any](t, client, a.server.URL, "/api/sheets/"+sheet["id"].(string))
			if !reflect.DeepEqual(stored["data"], tc.expected) {
				t.Fatalf("stored custom sheet data: got %#v, want %#v", stored["data"], tc.expected)
			}
		})
	}
}

func TestRuleBookAndSheetKeepAuthorKeyOrder(t *testing.T) {
	a := newTestApp(t)
	client, _ := login(t, a, "key-order@example.com")
	abilities := []string{"strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"}

	builtIn := get[map[string]any](t, client, a.server.URL, "/api/rule-books/00000000-0000-4000-8000-000000000005")
	order := builtIn["key_order"]
	if got := orderKeys(t, at(t, order, "attributes")); !reflect.DeepEqual(got[:7], append(append([]string{}, abilities...), "level")) {
		t.Fatalf("built-in attributes should keep the seed order: %v", got)
	}
	if got := orderKeys(t, at(t, order, "attributes", "children", "saving_throw_proficiencies")); !reflect.DeepEqual(got, abilities) {
		t.Fatalf("built-in saving throws: %v", got)
	}
	if got := orderKeys(t, at(t, order, "creation_rules", "children", "classes", "items", 0, "children", "defaults", "children", "saving_throw_proficiencies")); !reflect.DeepEqual(got, abilities) {
		t.Fatalf("class saving throws: %v", got)
	}
	if got := orderKeys(t, at(t, order, "monsters", "items", 0, "children", "stats")); !reflect.DeepEqual(got[:6], abilities) {
		t.Fatalf("monster stats: %v", got)
	}

	// json.RawMessage bodies keep the written order; Go maps would sort the keys.
	book := post[map[string]any](t, client, a.server.URL, "/api/rule-books", json.RawMessage(`{"name":"Ordered","attributes":{"zeal":1,"agility":2,"mind":{"will":1,"focus":2}}}`))
	bookPath := "/api/rule-books/" + book["id"].(string)
	if got := orderKeys(t, at(t, book["key_order"], "attributes")); !reflect.DeepEqual(got, []string{"zeal", "agility", "mind"}) {
		t.Fatalf("created book order: %v", got)
	}
	if got := orderKeys(t, at(t, book["key_order"], "attributes", "children", "mind")); !reflect.DeepEqual(got, []string{"will", "focus"}) {
		t.Fatalf("created book nested order: %v", got)
	}
	patch[map[string]any](t, client, a.server.URL, bookPath, map[string]any{"name": "Renamed"})
	if got := orderKeys(t, at(t, get[map[string]any](t, client, a.server.URL, bookPath)["key_order"], "attributes")); !reflect.DeepEqual(got, []string{"zeal", "agility", "mind"}) {
		t.Fatalf("a patch without attributes should keep their order: %v", got)
	}
	patched := patch[map[string]any](t, client, a.server.URL, bookPath, json.RawMessage(`{"attributes":{"mind":{"focus":2,"will":1},"zeal":1,"agility":2}}`))
	if got := orderKeys(t, at(t, patched["key_order"], "attributes")); !reflect.DeepEqual(got, []string{"mind", "zeal", "agility"}) {
		t.Fatalf("patched book order: %v", got)
	}

	sheet := post[map[string]any](t, client, a.server.URL, "/api/sheets", json.RawMessage(`{"name":"Ada","rule_book_id":"`+book["id"].(string)+`","data":{"zeal":3,"mind":{"will":4,"focus":5}}}`))
	stored := get[map[string]any](t, client, a.server.URL, "/api/sheets/"+sheet["id"].(string))
	if got := orderKeys(t, at(t, stored["key_order"], "data")); !reflect.DeepEqual(got, []string{"zeal", "mind", "agility"}) {
		t.Fatalf("sheet order should be the sent keys, then missing book defaults in book order: %v", got)
	}
	if got := orderKeys(t, at(t, stored["key_order"], "data", "children", "mind")); !reflect.DeepEqual(got, []string{"will", "focus"}) {
		t.Fatalf("sheet nested order: %v", got)
	}
}

// at walks a decoded JSON value: string steps index objects, int steps index arrays.
func at(t *testing.T, value any, path ...any) any {
	t.Helper()
	for _, step := range path {
		switch key := step.(type) {
		case string:
			object, ok := value.(map[string]any)
			if !ok {
				t.Fatalf("expected an object at %q, got %#v", key, value)
			}
			value = object[key]
		case int:
			items, ok := value.([]any)
			if !ok || key >= len(items) {
				t.Fatalf("expected an array with index %d, got %#v", key, value)
			}
			value = items[key]
		}
	}
	return value
}

func orderKeys(t *testing.T, order any) []string {
	t.Helper()
	raw, ok := at(t, order, "keys").([]any)
	if !ok {
		t.Fatalf("expected an order with keys, got %#v", order)
	}
	keys := make([]string, len(raw))
	for i, key := range raw {
		keys[i] = key.(string)
	}
	return keys
}

func TestAuthMagicLinkCookieAndReuse(t *testing.T) {
	a := newTestApp(t)
	c, u := login(t, a, "auth-"+time.Now().Format("150405.000")+"@example.com")
	if u["email"] == "" {
		t.Fatal("missing user")
	}
	me := get[map[string]any](t, c, a.server.URL, "/api/me")
	if me["email"] != u["email"] {
		t.Fatalf("me mismatch: %+v %+v", me, u)
	}
	if u["profile_complete"] != false {
		t.Fatalf("new user should require profile: %+v", u)
	}
	updated := patch[map[string]any](t, c, a.server.URL, "/api/me", map[string]string{"username": "Aria", "pronouns": "she/her"})
	if updated["username"] != "Aria" || updated["pronouns"] != "she/her" || updated["profile_complete"] != true {
		t.Fatalf("profile update mismatch: %+v", updated)
	}
	me = get[map[string]any](t, c, a.server.URL, "/api/me")
	if me["username"] != "Aria" || me["pronouns"] != "she/her" || me["profile_complete"] != true {
		t.Fatalf("profile me mismatch: %+v", me)
	}
	msgs, _ := a.redis.XRevRangeN(context.Background(), "email_jobs", "+", "-", 1).Result()
	rawURL := msgs[0].Values["url"].(string)
	parsed, _ := url.Parse(rawURL)
	reqBody := map[string]string{"token": parsed.Query().Get("token")}
	b, _ := json.Marshal(reqBody)
	res, err := c.Post(a.server.URL+"/api/auth/consume", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("reused token status=%d", res.StatusCode)
	}
}

func TestAuthRefreshTokens(t *testing.T) {
	a := newTestApp(t)
	ctx := context.Background()
	accessName, refreshName := a.cfg.SessionCookieName, a.cfg.SessionCookieName+"_refresh"
	signIn := func(email string) (access, refresh string) {
		t.Helper()
		c, _ := login(t, a, email)
		base, _ := url.Parse(a.server.URL)
		authURL, _ := url.Parse(a.server.URL + "/api/auth/refresh")
		for _, ck := range c.Jar.Cookies(base) {
			if ck.Name == refreshName {
				t.Fatal("the refresh cookie should only be sent to /api/auth")
			}
			if ck.Name == accessName {
				access = ck.Value
			}
		}
		for _, ck := range c.Jar.Cookies(authURL) {
			if ck.Name == refreshName {
				refresh = ck.Value
			}
		}
		if access == "" || refresh == "" {
			t.Fatalf("sign-in should set both cookies: access=%q refresh=%q", access, refresh)
		}
		return access, refresh
	}
	// send makes a request carrying exactly the given cookies and returns the cookies it set.
	send := func(method, path string, cookies map[string]string) (int, map[string]*http.Cookie, map[string]any) {
		t.Helper()
		req, _ := http.NewRequest(method, a.server.URL+path, nil)
		for name, value := range cookies {
			req.AddCookie(&http.Cookie{Name: name, Value: value})
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		set := map[string]*http.Cookie{}
		for _, ck := range res.Cookies() {
			set[ck.Name] = ck
		}
		var body map[string]any
		_ = json.NewDecoder(res.Body).Decode(&body)
		return res.StatusCode, set, body
	}
	me := func(access string) int {
		t.Helper()
		status, _, _ := send("GET", "/api/me", map[string]string{accessName: access})
		return status
	}
	refreshWith := func(refresh string) (int, map[string]*http.Cookie) {
		t.Helper()
		status, set, body := send("POST", "/api/auth/refresh", map[string]string{refreshName: refresh})
		if status == 200 && body["access_expires_in"] != a.cfg.AccessTTL.Seconds() {
			t.Fatalf("refresh should report the access lifetime: %+v", body)
		}
		return status, set
	}

	access1, refresh1 := signIn("refresh@example.com")
	if me(access1) != 200 {
		t.Fatal("a fresh access token should sign requests in")
	}

	// Refreshing rotates the refresh token and issues a new access token.
	status, set := refreshWith(refresh1)
	access2, refresh2 := set[accessName], set[refreshName]
	if status != 200 || access2 == nil || refresh2 == nil || refresh2.Value == refresh1 {
		t.Fatalf("refresh should rotate both cookies: status=%d cookies=%+v", status, set)
	}
	if !access2.HttpOnly || access2.Path != "/" || access2.MaxAge != int(a.cfg.AccessTTL.Seconds()) {
		t.Fatalf("access cookie attributes: %+v", access2)
	}
	if !refresh2.HttpOnly || refresh2.Path != "/api/auth" || refresh2.SameSite != http.SameSiteStrictMode || refresh2.MaxAge != int(a.cfg.SessionTTL.Seconds()) {
		t.Fatalf("refresh cookie attributes: %+v", refresh2)
	}
	if me(access2.Value) != 200 {
		t.Fatal("the refreshed access token should sign requests in")
	}

	// A tab refreshing with the just-rotated token gets access, and keeps the newer refresh cookie.
	status, set = refreshWith(refresh1)
	if status != 200 || set[accessName] == nil || set[refreshName] != nil || me(set[accessName].Value) != 200 {
		t.Fatalf("a concurrent refresh should get access only: status=%d cookies=%+v", status, set)
	}

	// Once the access token expires, requests fail until the client refreshes.
	if _, err := a.pool.Exec(ctx, `update session_access_tokens set expires_at=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	if me(access2.Value) != 401 {
		t.Fatal("an expired access token should be rejected")
	}
	status, set = refreshWith(refresh2.Value)
	if status != 200 || me(set[accessName].Value) != 200 {
		t.Fatalf("refresh after expiry: status=%d", status)
	}
	access3, refresh3 := set[accessName].Value, set[refreshName].Value

	// Replaying a rotated-away token after the grace period revokes the whole sign-in.
	if _, err := a.pool.Exec(ctx, `update sessions set refreshed_at=now()-interval '1 minute'`); err != nil {
		t.Fatal(err)
	}
	if status, _ := refreshWith(refresh2.Value); status != 401 {
		t.Fatalf("a replayed refresh token should be rejected, got %d", status)
	}
	if status, _ := refreshWith(refresh3); status != 401 || me(access3) != 401 {
		t.Fatal("a replayed refresh token should revoke the sign-in's current tokens")
	}

	// Signing out works with only the refresh cookie and ends the sign-in.
	access4, refresh4 := signIn("refresh-logout@example.com")
	if _, err := a.pool.Exec(ctx, `update session_access_tokens set expires_at=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	status, set, _ = send("POST", "/api/auth/logout", map[string]string{refreshName: refresh4})
	if status != 204 || set[accessName] == nil || set[accessName].MaxAge >= 0 || set[refreshName] == nil || set[refreshName].MaxAge >= 0 {
		t.Fatalf("logout should clear both cookies: status=%d cookies=%+v", status, set)
	}
	if status, _ := refreshWith(refresh4); status != 401 || me(access4) != 401 {
		t.Fatal("a signed-out refresh token should be rejected")
	}
	if status, _, _ := send("POST", "/api/auth/logout", nil); status != 204 {
		t.Fatalf("logout without cookies should still succeed, got %d", status)
	}
}

func TestFriendsLifecycle(t *testing.T) {
	a := newTestApp(t)
	ca, ua := login(t, a, "a@example.com")
	cb, ub := login(t, a, "b@example.com")
	_ = ua
	_ = ub
	fr := post[map[string]any](t, ca, a.server.URL, "/api/friends", map[string]string{"email": "b@example.com"})
	buckets := get[map[string][]map[string]any](t, cb, a.server.URL, "/api/friends")
	if len(buckets["pending_inbound"]) != 1 {
		t.Fatalf("expected inbound: %+v", buckets)
	}
	patch[map[string]any](t, cb, a.server.URL, "/api/friends/"+fr["id"].(string), map[string]string{"status": "accepted"})
	aBuckets := get[map[string][]map[string]any](t, ca, a.server.URL, "/api/friends")
	bBuckets := get[map[string][]map[string]any](t, cb, a.server.URL, "/api/friends")
	if len(aBuckets["accepted"]) != 1 || len(bBuckets["accepted"]) != 1 {
		t.Fatalf("accepted missing: %+v %+v", aBuckets, bBuckets)
	}
	req, _ := http.NewRequest("DELETE", a.server.URL+"/api/friends/"+fr["id"].(string), nil)
	res, err := ca.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 204 {
		t.Fatalf("delete status=%d", res.StatusCode)
	}
}

// readNotification reads notification socket events until one of the given kind arrives.
func readNotification(t *testing.T, c *websocket.Conn, kind string) map[string]any {
	t.Helper()
	for {
		body := readType(t, c, "notification")["body"].(map[string]any)
		if body["kind"] == kind {
			return body
		}
	}
}

func TestFriendRequestNotifications(t *testing.T) {
	a := newTestApp(t)
	ca, _ := login(t, a, "notify-a@example.com")
	cb, _ := login(t, a, "notify-b@example.com")
	patch[map[string]any](t, ca, a.server.URL, "/api/me", map[string]string{"username": "Asha", "pronouns": "she/her"})
	aWS := dialPath(t, a, ca, "/api/notifications/ws")
	defer aWS.Close()
	bWS := dialPath(t, a, cb, "/api/notifications/ws")
	defer bWS.Close()

	fr := post[map[string]any](t, ca, a.server.URL, "/api/friends", map[string]string{"email": "notify-b@example.com"})
	if actor := readNotification(t, bWS, "friend.requested")["actor"].(map[string]any); actor["username"] != "Asha" {
		t.Fatalf("request should name the requester: %+v", actor)
	}
	waiting := get[map[string][]map[string]any](t, cb, a.server.URL, "/api/notifications")
	if len(waiting["friend_requests"]) != 1 || waiting["friend_requests"][0]["id"] != fr["id"] || len(waiting["room_invitations"]) != 0 {
		t.Fatalf("expected the pending request: %+v", waiting)
	}
	patch[map[string]any](t, cb, a.server.URL, "/api/friends/"+fr["id"].(string), map[string]string{"status": "accepted"})
	readNotification(t, aWS, "friend.accepted")
	if waiting := get[map[string][]map[string]any](t, cb, a.server.URL, "/api/notifications"); len(waiting["friend_requests"]) != 0 {
		t.Fatalf("an accepted request no longer waits: %+v", waiting)
	}
	if status := statusOf(t, cb, "DELETE", a.server.URL+"/api/friends/"+fr["id"].(string), nil); status != 204 {
		t.Fatalf("remove status=%d", status)
	}
	readNotification(t, aWS, "friend.changed")
}

func TestRoomInvitationsByUsername(t *testing.T) {
	a := newTestApp(t)
	dm, du := login(t, a, "invite-by-name-dm@example.com")
	player, pu := login(t, a, "invite-by-name-player@example.com")
	other, _ := login(t, a, "invite-by-name-other@example.com")
	blocker, _ := login(t, a, "invite-by-name-blocker@example.com")
	for c, name := range map[*http.Client]string{dm: "Gwen", player: "Paladin Pete", other: "Petra", blocker: "Pete the Blocker"} {
		patch[map[string]any](t, c, a.server.URL, "/api/me", map[string]string{"username": name, "pronouns": "they/them"})
	}
	fr := post[map[string]any](t, blocker, a.server.URL, "/api/friends", map[string]string{"email": "invite-by-name-dm@example.com"})
	patch[map[string]any](t, blocker, a.server.URL, "/api/friends/"+fr["id"].(string), map[string]string{"status": "blocked"})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Invited Table"})
	roomID := room["id"].(string)
	base := a.server.URL + "/api/rooms/" + roomID

	candidates := get[[]map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/invite-candidates?q=pet")
	if len(candidates) != 2 || candidates[0]["username"] != "Petra" || candidates[1]["username"] != "Paladin Pete" {
		t.Fatalf("expected prefix match first and the blocker left out: %+v", candidates)
	}
	if short := get[[]map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/invite-candidates?q=p"); len(short) != 0 {
		t.Fatalf("one letter should not search: %+v", short)
	}
	if status, code := errorOf(t, dm, "POST", base+"/invitations", map[string]string{"username": "Pete the Blocker"}); status != 404 || code != "not_found" {
		t.Fatalf("a block must look like an unknown user, got %d %s", status, code)
	}
	if status := statusOf(t, player, "GET", base+"/invite-candidates?q=pet", nil); status != 403 {
		t.Fatalf("non-members may not search, got %d", status)
	}

	pWS := dialPath(t, a, player, "/api/notifications/ws")
	defer pWS.Close()
	dmNotes := dialPath(t, a, dm, "/api/notifications/ws")
	defer dmNotes.Close()
	dmRoom := dialWS(t, a, dm, roomID)
	defer dmRoom.Close()
	readType(t, dmRoom, "state.snapshot")

	invitation := post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/invitations", map[string]string{"username": "Paladin Pete"})
	if invitee := invitation["invitee"].(map[string]any); invitee["id"] != pu["id"] {
		t.Fatalf("invitation should name the invitee: %+v", invitation)
	}
	note := readNotification(t, pWS, "room_invitation.created")
	if note["room"].(map[string]any)["name"] != "Invited Table" || note["actor"].(map[string]any)["id"] != du["id"] {
		t.Fatalf("invitation notification should name the room and game master: %+v", note)
	}
	if status, code := errorOf(t, dm, "POST", base+"/invitations", map[string]string{"username": "Paladin Pete"}); status != 409 || code != "invitation_exists" {
		t.Fatalf("second invitation: %d %s", status, code)
	}
	if marked := get[[]map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/invite-candidates?q=paladin"); len(marked) != 1 || marked[0]["invited"] != true {
		t.Fatalf("pending invitee should be marked: %+v", marked)
	}
	waiting := get[map[string][]map[string]any](t, player, a.server.URL, "/api/notifications")
	if len(waiting["room_invitations"]) != 1 || waiting["room_invitations"][0]["id"] != invitation["id"] {
		t.Fatalf("player should see the invitation: %+v", waiting)
	}
	if status := statusOf(t, other, "POST", a.server.URL+"/api/room-invitations/"+invitation["id"].(string)+"/accept", nil); status != 404 {
		t.Fatalf("only the invitee may accept, got %d", status)
	}

	joined := post[map[string]any](t, player, a.server.URL, "/api/room-invitations/"+invitation["id"].(string)+"/accept", nil)
	if joined["room_id"] != roomID || joined["is_dm"] != false {
		t.Fatalf("accept should join as a player: %+v", joined)
	}
	readType(t, dmRoom, "member.joined")
	readNotification(t, dmNotes, "room_invitation.accepted")
	members := get[[]map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/members")
	if len(members) != 2 {
		t.Fatalf("player should be a member: %+v", members)
	}
	if pending := get[[]map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/invitations"); len(pending) != 0 {
		t.Fatalf("an accepted invitation is spent: %+v", pending)
	}
	if status, code := errorOf(t, dm, "POST", base+"/invitations", map[string]string{"username": "Paladin Pete"}); status != 409 || code != "already_member" {
		t.Fatalf("inviting a member: %d %s", status, code)
	}
	if status := statusOf(t, player, "POST", base+"/invitations", map[string]string{"username": "Petra"}); status != 403 {
		t.Fatalf("players may not invite, got %d", status)
	}

	declined := post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/invitations", map[string]string{"username": "Petra"})
	if status := statusOf(t, other, "DELETE", a.server.URL+"/api/room-invitations/"+declined["id"].(string), nil); status != 204 {
		t.Fatalf("decline status=%d", status)
	}
	readNotification(t, dmNotes, "room_invitation.removed")
	if status := statusOf(t, other, "GET", base, nil); status != 403 {
		t.Fatalf("declining must not join, got %d", status)
	}
}

func TestRoomCreatorIsDMAndCanUseMapWithoutSheet(t *testing.T) {
	a := newTestApp(t)
	dm, u := login(t, a, "dm-nosheet@example.com")
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Sheetless Table"})
	members := get[[]map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/members")
	if len(members) != 1 || members[0]["user_id"] != u["id"] || members[0]["is_dm"] != true {
		t.Fatalf("creator should be the room DM: %+v user=%+v", members, u)
	}
	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Arena", "width_m": 10, "height_m": 10})
	post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})
	tok := post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/tokens", map[string]any{"name": "Goblin", "x_m": 2, "y_m": 2})
	if tok["sheet_id"] != nil || tok["owner_user_id"] != u["id"] || tok["name"] != "Goblin" {
		t.Fatalf("DM token should not require a sheet: %+v", tok)
	}
}

func TestRoomInviteCarriesRuleBookAndPlayerChoosesMatchingSheet(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "invite-dm@example.com")
	player, pu := login(t, a, "invite-player@example.com")
	outsider, _ := login(t, a, "invite-outsider@example.com")
	const defaultID = "00000000-0000-4000-8000-000000000005"
	private := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "House Rules", "attributes": map[string]any{"grit": 1}})
	if status := statusOf(t, player, "POST", a.server.URL+"/api/rooms", map[string]any{"name": "Stolen", "rule_book_id": private["id"]}); status != 400 {
		t.Fatalf("room creation with an unreadable rule book: status %d", status)
	}
	if defaulted := post[map[string]any](t, player, a.server.URL, "/api/rooms", map[string]any{"name": "Default"}); defaulted["rule_book"].(map[string]any)["id"] != defaultID {
		t.Fatalf("rooms without a rule book should use the built-in book: %+v", defaulted)
	}
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "House Table", "rule_book_id": private["id"]})
	roomID := room["id"].(string)
	if book := room["rule_book"].(map[string]any); book["id"] != private["id"] || book["name"] != "House Rules" {
		t.Fatalf("created room should carry its rule book: %+v", room)
	}
	if status := statusOf(t, player, "GET", a.server.URL+"/api/rule-books/"+private["id"].(string), nil); status != 404 {
		t.Fatalf("private rule book visible before joining: status %d", status)
	}
	other := post[map[string]any](t, player, a.server.URL, "/api/rule-books", map[string]any{"name": "Other System", "attributes": map[string]any{}})
	otherSheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": other["id"], "name": "Wrong System", "data": map[string]any{}})

	invitePath := "/api/invites/" + room["invite_code"].(string)
	preview := get[map[string]any](t, player, a.server.URL, invitePath)
	if book := preview["rule_book"].(map[string]any); preview["room_id"] != roomID || preview["name"] != "House Table" || book["id"] != private["id"] || book["name"] != "House Rules" || preview["requires_password"] != false || preview["member"] != nil {
		t.Fatalf("invite preview should show the room and rule book before joining: %+v", preview)
	}
	if status := statusOf(t, player, "GET", a.server.URL+"/api/invites/NOPE", nil); status != 404 {
		t.Fatalf("unknown invite: status %d", status)
	}
	if status := statusOf(t, player, "POST", a.server.URL+"/api/rooms/join", map[string]any{"invite_code": room["invite_code"], "sheet_id": otherSheet["id"]}); status != 400 {
		t.Fatalf("joined with a character from another rule book: status %d", status)
	}
	if member := get[map[string]any](t, player, a.server.URL, invitePath)["member"]; member != nil {
		t.Fatalf("a rejected join must not create membership: %+v", member)
	}
	joined := post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	if book := joined["rule_book"].(map[string]any); joined["room_id"] != roomID || book["id"] != private["id"] || book["name"] != "House Rules" || joined["is_dm"] != false || joined["sheet_id"] != nil {
		t.Fatalf("invite should carry the room rule book: %+v", joined)
	}
	// Joining grants use of the room's rule book for character creation, but not to outsiders.
	get[map[string]any](t, player, a.server.URL, "/api/rule-books/"+private["id"].(string))
	if status := statusOf(t, outsider, "GET", a.server.URL+"/api/rule-books/"+private["id"].(string), nil); status != 404 {
		t.Fatalf("private rule book leaked to a non-member: status %d", status)
	}
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": private["id"], "name": "Housed", "data": map[string]any{}})
	dmRoom := dialWS(t, a, dm, roomID)
	defer dmRoom.Close()
	readType(t, dmRoom, "state.snapshot")

	memberPath := "/api/rooms/" + roomID + "/members/" + pu["id"].(string)
	if status := statusOf(t, player, "PATCH", a.server.URL+memberPath, map[string]any{"sheet_id": otherSheet["id"]}); status != 400 {
		t.Fatalf("sheet from another rule book accepted: status %d", status)
	}
	if status := statusOf(t, player, "PATCH", a.server.URL+memberPath, map[string]any{"is_dm": true}); status != 403 {
		t.Fatalf("player promoted themselves: status %d", status)
	}
	dmMembers := get[[]map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/members")
	if status := statusOf(t, player, "PATCH", a.server.URL+"/api/rooms/"+roomID+"/members/"+dmMembers[0]["user_id"].(string), map[string]any{"sheet_id": sheet["id"]}); status != 403 {
		t.Fatalf("player chose another member's character: status %d", status)
	}
	chosen := patch[map[string]any](t, player, a.server.URL, memberPath, map[string]any{"sheet_id": sheet["id"]})
	if chosen["sheet_id"] != sheet["id"] || chosen["is_dm"] != false {
		t.Fatalf("player should choose their own matching character: %+v", chosen)
	}
	// The table hears about the new character, so the game master can prompt checks for it right away.
	if ev := readType(t, dmRoom, "member.updated"); ev["body"].(map[string]any)["user_id"] != pu["id"] {
		t.Fatalf("choosing a character should tell the table: %+v", ev)
	}
	cleared := patch[map[string]any](t, player, a.server.URL, memberPath, map[string]any{"sheet_id": nil})
	if cleared["sheet_id"] != nil {
		t.Fatalf("choosing no sheet should clear the character: %+v", cleared)
	}
	rejoined := post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"], "sheet_id": sheet["id"]})
	if rejoined["sheet_id"] != sheet["id"] {
		t.Fatalf("joining with a character should choose it: %+v", rejoined)
	}
	if again := post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]}); again["sheet_id"] != sheet["id"] {
		t.Fatalf("rejoining without a character should keep the chosen one: %+v", again)
	}
	if member := get[map[string]any](t, player, a.server.URL, invitePath)["member"].(map[string]any); member["sheet_id"] != sheet["id"] || member["is_dm"] != false {
		t.Fatalf("invite preview should report existing membership: %+v", member)
	}

	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Hall", "width_m": 10, "height_m": 10})
	post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})
	if status := statusOf(t, player, "POST", a.server.URL+"/api/rooms/"+roomID+"/tokens", map[string]any{"sheet_id": otherSheet["id"], "name": "Wrong"}); status != 403 {
		t.Fatalf("token from another rule book accepted: status %d", status)
	}
	post[map[string]any](t, player, a.server.URL, "/api/rooms/"+roomID+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Housed"})
}

func TestRoomListHidesRoomsYouHaveNotJoined(t *testing.T) {
	a := newTestApp(t)
	owner, _ := login(t, a, "list-owner@example.com")
	outsider, _ := login(t, a, "list-outsider@example.com")
	private := post[map[string]any](t, owner, a.server.URL, "/api/rooms", map[string]any{"name": "Secret Table", "is_public": false, "password": "hunter2"})
	public := post[map[string]any](t, owner, a.server.URL, "/api/rooms", map[string]any{"name": "Open Table", "is_public": true})
	names := func(c *http.Client, path string) map[string]bool {
		t.Helper()
		out := map[string]bool{}
		for _, row := range get[[]map[string]any](t, c, a.server.URL, path) {
			out[row["name"].(string)] = true
		}
		return out
	}
	if got := names(owner, "/api/rooms"); !got["Secret Table"] || !got["Open Table"] {
		t.Fatalf("owner should list both rooms: %v", got)
	}
	if got := names(outsider, "/api/rooms"); len(got) != 0 {
		t.Fatalf("outsider should not list rooms they have not joined: %v", got)
	}
	if got := names(outsider, "/api/rooms?public=true"); got["Secret Table"] || !got["Open Table"] {
		t.Fatalf("public listing should include only public rooms: %v", got)
	}
	if status := statusOf(t, outsider, "POST", a.server.URL+"/api/rooms/join", map[string]any{"invite_code": private["invite_code"]}); status != 403 {
		t.Fatalf("private room joined without its password: %d", status)
	}
	post[map[string]any](t, outsider, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": public["invite_code"]})
	if got := names(outsider, "/api/rooms"); got["Secret Table"] || !got["Open Table"] {
		t.Fatalf("outsider should list only the room they joined: %v", got)
	}
}

func TestMapDeleteOwnerOnlyAndRefusedWhileAttached(t *testing.T) {
	a := newTestApp(t)
	owner, _ := login(t, a, "map-delete-owner@example.com")
	editor, eu := login(t, a, "map-delete-editor@example.com")
	outsider, _ := login(t, a, "map-delete-outsider@example.com")
	loose := post[map[string]any](t, owner, a.server.URL, "/api/maps", map[string]any{"name": "Loose Map"})
	loosePath := "/api/maps/" + loose["id"].(string)
	post[map[string]any](t, owner, a.server.URL, loosePath+"/structures", map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 1, "y": 0}, {"x": 1, "y": 5}}})
	if status := statusOf(t, owner, "POST", a.server.URL+loosePath+"/editors", map[string]any{"user_id": eu["id"]}); status != 204 {
		t.Fatalf("adding editor: status %d", status)
	}
	if status := statusOf(t, editor, "DELETE", a.server.URL+loosePath, nil); status != 403 {
		t.Fatalf("editor deleted a map they do not own: status %d", status)
	}
	if status := statusOf(t, outsider, "DELETE", a.server.URL+loosePath, nil); status != 404 {
		t.Fatalf("outsider delete of a private map should be not found: status %d", status)
	}
	if status := statusOf(t, owner, "DELETE", a.server.URL+loosePath, nil); status != 204 {
		t.Fatalf("owner delete: status %d", status)
	}
	if status := statusOf(t, owner, "GET", a.server.URL+loosePath, nil); status != 404 {
		t.Fatalf("deleted map still readable: status %d", status)
	}
	if status := statusOf(t, owner, "DELETE", a.server.URL+loosePath, nil); status != 404 {
		t.Fatalf("second delete should be not found: status %d", status)
	}

	room := post[map[string]any](t, owner, a.server.URL, "/api/rooms", map[string]any{"name": "Map Delete Table"})
	attached := post[map[string]any](t, owner, a.server.URL, "/api/maps", map[string]any{"name": "Attached Map"})
	attachedPath := "/api/maps/" + attached["id"].(string)
	post[map[string]any](t, owner, a.server.URL, "/api/rooms/"+room["id"].(string)+"/maps", map[string]any{"map_id": attached["id"], "is_active": true})
	req, _ := http.NewRequest("DELETE", a.server.URL+attachedPath, nil)
	res, err := owner.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body struct {
		Error struct{ Code string } `json:"error"`
	}
	_ = json.NewDecoder(res.Body).Decode(&body)
	if res.StatusCode != 409 || body.Error.Code != "map_in_use" {
		t.Fatalf("deleting an attached map: status %d code %q", res.StatusCode, body.Error.Code)
	}
	if got := get[map[string]any](t, owner, a.server.URL, attachedPath); got["id"] != attached["id"] {
		t.Fatalf("attached map should survive a refused delete: %+v", got)
	}
}

func TestMapStructureOrderAndGroups(t *testing.T) {
	a := newTestApp(t)
	owner, _ := login(t, a, "map-order-owner@example.com")
	m := post[map[string]any](t, owner, a.server.URL, "/api/maps", map[string]any{"name": "Layered Map"})
	mapPath := "/api/maps/" + m["id"].(string)
	ids := make([]string, 3)
	for i := range ids {
		created := post[map[string]any](t, owner, a.server.URL, mapPath+"/structures", map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": float64(i), "y": 0}, {"x": float64(i), "y": 5}}})
		if created["z_index"] != float64(i+1) {
			t.Fatalf("structure %d should be placed on top with z_index %d: %+v", i, i+1, created)
		}
		ids[i] = created["id"].(string)
	}
	listed := func() []any {
		t.Helper()
		return get[map[string]any](t, owner, a.server.URL, mapPath)["structures"].([]any)
	}
	order := func() []string {
		t.Helper()
		out := []string{}
		for _, row := range listed() {
			out = append(out, row.(map[string]any)["id"].(string))
		}
		return out
	}
	if got := order(); strings.Join(got, ",") != strings.Join(ids, ",") {
		t.Fatalf("structures should list in draw order: got %v want %v", got, ids)
	}
	patch[map[string]any](t, owner, a.server.URL, mapPath+"/structures/"+ids[2], map[string]any{"z_index": 0})
	if got := order(); got[0] != ids[2] {
		t.Fatalf("sending to back should list the structure first: %v", got)
	}

	const groupID = "6f1c2a7e-4b8d-4c3e-9a51-0d2f6b7c8e90"
	grouped := patch[map[string]any](t, owner, a.server.URL, mapPath+"/structures/"+ids[0], map[string]any{"group_id": groupID})
	if grouped["group_id"] != groupID {
		t.Fatalf("patch should return the group: %+v", grouped)
	}
	groupOf := func(id string) any {
		t.Helper()
		return entityByID(t, listed(), id)["group_id"]
	}
	if got := groupOf(ids[0]); got != groupID {
		t.Fatalf("group_id should persist: %v", got)
	}
	patch[map[string]any](t, owner, a.server.URL, mapPath+"/structures/"+ids[0], map[string]any{"kind": "door"})
	if got := groupOf(ids[0]); got != groupID {
		t.Fatalf("a patch without group_id should keep the group: %v", got)
	}
	patch[map[string]any](t, owner, a.server.URL, mapPath+"/structures/"+ids[0], map[string]any{"group_id": nil})
	if got := groupOf(ids[0]); got != nil {
		t.Fatalf("group_id null should clear the group: %v", got)
	}

	for _, method := range []string{"POST", "PATCH"} {
		url := a.server.URL + mapPath + "/structures"
		if method == "PATCH" {
			url += "/" + ids[1]
		}
		b, _ := json.Marshal(map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 0, "y": 0}, {"x": 1, "y": 0}}, "group_id": "nope"})
		req, _ := http.NewRequest(method, url, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		res, err := owner.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			Error struct{ Code string } `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&body)
		res.Body.Close()
		if res.StatusCode != 400 || body.Error.Code != "invalid_group_id" {
			t.Fatalf("%s with an invalid group_id: status %d code %q", method, res.StatusCode, body.Error.Code)
		}
	}
	if got := len(listed()); got != 3 {
		t.Fatalf("an invalid group_id should not create a structure: %d structures", got)
	}
}

func statusOf(t *testing.T, c *http.Client, method, url string, body any) int {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}

// errorOf sends a request and returns its status and error code.
func errorOf(t *testing.T, c *http.Client, method, url string, body any) (int, string) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, url, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out.Error.Code
}

func TestRoomWebsocketMovementAndChat(t *testing.T) {
	a := newTestApp(t)
	dm, du := login(t, a, "dm@example.com")
	player, pu := login(t, a, "player@example.com")
	third, _ := login(t, a, "third@example.com")
	_ = third
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Rules", "attributes": map[string]any{}, "is_public": true})
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "data": map[string]any{}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Table", "rule_book_id": rb["id"]})
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	post[map[string]any](t, third, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Arena", "width_m": 10, "height_m": 10})
	wall := post[map[string]any](t, dm, a.server.URL, "/api/maps/"+gm["id"].(string)+"/structures", map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 5, "y": 0}, {"x": 5, "y": 10}}, "blocks_vision": true, "blocks_movement": true, "blocks_attacks": true, "cover_bonus": 0, "pass_rules": map[string]bool{}})
	post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})
	tok := post[map[string]any](t, player, a.server.URL, "/api/rooms/"+room["id"].(string)+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Hero", "x_m": 1, "y_m": 1})
	enemy := post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/tokens", map[string]any{"name": "Goblin", "x_m": 3, "y_m": 2})
	dmWS := dialWS(t, a, dm, room["id"].(string))
	defer dmWS.Close()
	pWS := dialWS(t, a, player, room["id"].(string))
	defer pWS.Close()
	readType(t, dmWS, "state.snapshot")
	readType(t, pWS, "state.snapshot")
	sendWS(t, pWS, "token.move", "move-block", map[string]any{"tokenId": tok["id"], "to": map[string]float64{"x": 6, "y": 1}, "path": []map[string]float64{{"x": 1, "y": 1}, {"x": 6, "y": 1}}})
	if ev := readType(t, pWS, "error"); ev["requestId"] != "move-block" {
		t.Fatalf("wrong error: %+v", ev)
	}
	sendWS(t, pWS, "token.move", "move-ok", map[string]any{"tokenId": tok["id"], "to": map[string]float64{"x": 2, "y": 1}, "path": []map[string]float64{{"x": 1, "y": 1}, {"x": 2, "y": 1}}})
	readType(t, dmWS, "token.moved")

	sendWS(t, pWS, "token.move", "move-enemy", map[string]any{"tokenId": enemy["id"], "to": map[string]float64{"x": 4, "y": 2}})
	if ev := readType(t, pWS, "error"); ev["requestId"] != "move-enemy" {
		t.Fatalf("player should not move the DM token: %+v", ev)
	}
	sendWS(t, dmWS, "token.move", "dm-move-enemy", map[string]any{"tokenId": enemy["id"], "to": map[string]float64{"x": 3, "y": 3}})
	readType(t, pWS, "token.moved")

	sendWS(t, pWS, "token.visibility", "hide-enemy-player", map[string]any{"tokenId": enemy["id"], "isHidden": true})
	if ev := readType(t, pWS, "error"); ev["requestId"] != "hide-enemy-player" {
		t.Fatalf("player should not hide the DM token: %+v", ev)
	}
	sendWS(t, dmWS, "token.visibility", "hide-enemy", map[string]any{"tokenId": enemy["id"], "isHidden": true})
	readType(t, pWS, "token.updated")
	dmState := get[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/state")
	if hiddenEnemy := entityByID(t, dmState["visibleTokens"], enemy["id"].(string)); hiddenEnemy["is_hidden"] != true {
		t.Fatalf("DM should see the hidden enemy: %+v", hiddenEnemy)
	}
	playerState := get[map[string]any](t, player, a.server.URL, "/api/rooms/"+room["id"].(string)+"/state")
	if encoded, _ := json.Marshal(playerState); strings.Contains(string(encoded), enemy["id"].(string)) {
		t.Fatalf("player should not receive the hidden enemy: %s", encoded)
	}

	movedGeometry := []map[string]float64{{"x": 6, "y": 0}, {"x": 6, "y": 10}}
	sendWS(t, pWS, "structure.move", "move-wall-player", map[string]any{"structureId": wall["id"], "geometry": movedGeometry})
	if ev := readType(t, pWS, "error"); ev["requestId"] != "move-wall-player" {
		t.Fatalf("player should not move structures: %+v", ev)
	}
	sendWS(t, dmWS, "structure.move", "move-wall", map[string]any{"structureId": wall["id"], "geometry": movedGeometry})
	readType(t, pWS, "structure.moved")
	dmState = get[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/state")
	movedWall := entityByID(t, dmState["structures"], wall["id"].(string))
	firstPoint := movedWall["geometry"].([]any)[0].(map[string]any)
	if firstPoint["x"] != float64(6) {
		t.Fatalf("room structure move was not retained: %+v", movedWall)
	}

	rotatedGeometry := []map[string]float64{{"x": 7.29, "y": 0.17}, {"x": 4.71, "y": 9.83}}
	sendWS(t, pWS, "structure.move", "rotate-wall-player", map[string]any{"structureId": wall["id"], "geometry": rotatedGeometry})
	if ev := readType(t, pWS, "error"); ev["requestId"] != "rotate-wall-player" || ev["body"].(map[string]any)["code"] != "forbidden" {
		t.Fatalf("player should not rotate structures: %+v", ev)
	}
	for _, transform := range []struct {
		id       string
		geometry []map[string]float64
	}{
		{"rotate-wall-rounded", rotatedGeometry},
		{"rotate-wall-again", []map[string]float64{{"x": 11, "y": 5}, {"x": 1, "y": 5}}},
		{"move-rotated-wall", []map[string]float64{{"x": 12, "y": 6}, {"x": 2, "y": 6}}},
	} {
		sendWS(t, dmWS, "structure.move", transform.id, map[string]any{"structureId": wall["id"], "geometry": transform.geometry})
		event := readType(t, pWS, "structure.moved")
		expected, _ := json.Marshal(transform.geometry)
		broadcast, _ := json.Marshal(event["body"].(map[string]any)["geometry"])
		if event["requestId"] != transform.id || !bytes.Equal(broadcast, expected) {
			t.Fatalf("transform was not broadcast: %+v", event)
		}
		dmState = get[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/state")
		persisted, _ := json.Marshal(entityByID(t, dmState["structures"], wall["id"].(string))["geometry"])
		if !bytes.Equal(persisted, expected) {
			t.Fatalf("transform %s was not retained: got %s, want %s", transform.id, persisted, expected)
		}
	}
	sourceMap := get[map[string]any](t, dm, a.server.URL, "/api/maps/"+gm["id"].(string))
	sourceGeometry, _ := json.Marshal(entityByID(t, sourceMap["structures"], wall["id"].(string))["geometry"])
	if string(sourceGeometry) != `[{"x":5,"y":0},{"x":5,"y":10}]` {
		t.Fatalf("room rotation changed the source map: %s", sourceGeometry)
	}
	sendWS(t, dmWS, "structure.move", "resize-wall", map[string]any{"structureId": wall["id"], "geometry": []map[string]float64{{"x": 12, "y": 6}, {"x": 0, "y": 6}}})
	if ev := readType(t, dmWS, "error"); ev["requestId"] != "resize-wall" || ev["body"].(map[string]any)["code"] != "invalid_transform" {
		t.Fatalf("resizing should still be rejected: %+v", ev)
	}
	dmState = get[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/state")
	afterRejection, _ := json.Marshal(entityByID(t, dmState["structures"], wall["id"].(string))["geometry"])
	if string(afterRejection) != `[{"x":12,"y":6},{"x":2,"y":6}]` {
		t.Fatalf("rejected resize changed the retained rotation: %s", afterRejection)
	}

	sendWS(t, pWS, "structure.visibility", "hide-wall-player", map[string]any{"structureId": wall["id"], "isHidden": true})
	if ev := readType(t, pWS, "error"); ev["requestId"] != "hide-wall-player" {
		t.Fatalf("player should not hide structures: %+v", ev)
	}
	sendWS(t, dmWS, "structure.visibility", "hide-wall", map[string]any{"structureId": wall["id"], "isHidden": true})
	readType(t, pWS, "structure.updated")
	dmState = get[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/state")
	if hiddenWall := entityByID(t, dmState["structures"], wall["id"].(string)); hiddenWall["is_hidden"] != true {
		t.Fatalf("DM should see the hidden structure: %+v", hiddenWall)
	}
	playerState = get[map[string]any](t, player, a.server.URL, "/api/rooms/"+room["id"].(string)+"/state")
	if encoded, _ := json.Marshal(playerState); strings.Contains(string(encoded), wall["id"].(string)) {
		t.Fatalf("player should not receive the hidden structure: %s", encoded)
	}
	sendWS(t, dmWS, "chat.send", "dm-private", map[string]any{"text": "secret", "recipientUserIds": []string{pu["id"].(string)}})
	if ev := readType(t, pWS, "chat.message"); !strings.Contains(fmtBody(ev), "secret") {
		t.Fatalf("missing private chat: %+v", ev)
	}

	// A roll reaches each socket once; the message sent after it marks the end of its events.
	sendWS(t, pWS, "chat.send", "roll-once", map[string]any{"rollExpression": "1d4"})
	sendWS(t, pWS, "chat.send", "after-roll", map[string]any{"text": "after roll"})
	rollEvents := 0
	for deadline := time.Now().Add(5 * time.Second); ; {
		if time.Now().After(deadline) {
			t.Fatal("did not read the message sent after the roll")
		}
		_ = pWS.SetReadDeadline(time.Now().Add(time.Second))
		var ev map[string]any
		if err := pWS.ReadJSON(&ev); err != nil {
			t.Fatal(err)
		}
		if ev["requestId"] == "after-roll" {
			break
		}
		if ev["requestId"] == "roll-once" && (ev["type"] == "roll.result" || ev["type"] == "chat.message") {
			rollEvents++
		}
	}
	if rollEvents != 1 {
		t.Fatalf("a roll should arrive once, got %d events", rollEvents)
	}
	_ = du
}

func TestRoomTokenActions(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "attack-dm@example.com")
	player, _ := login(t, a, "attack-player@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Attack Rules", "attributes": map[string]any{"strength": 16, "dexterity": 12, "proficiency_bonus": 2}, "is_public": true})
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "data": map[string]any{}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Battle", "rule_book_id": rb["id"]})
	roomPath := "/api/rooms/" + room["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Arena", "width_m": 10, "height_m": 10})
	wall := post[map[string]any](t, dm, a.server.URL, "/api/maps/"+gm["id"].(string)+"/structures", map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 5, "y": 0}, {"x": 5, "y": 10}}, "blocks_vision": false, "blocks_movement": true, "blocks_attacks": true, "cover_bonus": 0, "pass_rules": map[string]bool{}})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})
	hero := post[map[string]any](t, player, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Hero", "x_m": 1, "y_m": 1})
	goblin := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"name": "Goblin", "x_m": 2, "y_m": 1})
	orc := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"name": "Orc", "x_m": 4, "y_m": 1})
	troll := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"name": "Troll", "x_m": 6, "y_m": 1})
	heroID, goblinID, orcID := hero["id"].(string), goblin["id"].(string), orc["id"].(string)
	heroActions := roomPath + "/tokens/" + heroID + "/actions"
	goblinActions := roomPath + "/tokens/" + goblinID + "/actions"

	heroLists := map[string]any{
		"attacks": []map[string]any{
			{"id": "sword", "name": "Sword", "range_m": 1.5, "ability": "strength", "proficient": true, "attack_bonus": 0, "damage": "1d8", "damage_bonus": 0, "damage_type": "slashing"},
			{"id": "bow", "name": "Bow", "range_m": 20, "ability": "dexterity", "proficient": true, "attack_bonus": 0, "damage": "1d6", "damage_bonus": 0},
		},
		"actions": []map[string]any{
			{"id": "cure", "name": "Cure", "kind": "heal", "range_m": 1.5, "dice": "1d8", "ability": "dexterity", "ability_to_dice": true},
			{"id": "burst", "name": "Burst", "kind": "save", "range_m": 20, "area_radius_m": 2, "save_ability": "dexterity", "half_on_save": true, "dice": "2d6", "damage_type": "fire", "uses": map[string]any{"max": 1, "remaining": 1}},
		},
		"items": []map[string]any{{"id": "potion", "name": "Potion", "kind": "heal", "range_m": 1.5, "dice": "2d4", "dice_bonus": 2, "quantity": 1}},
	}
	saved := patch[map[string]any](t, player, a.server.URL, heroActions, heroLists)
	sword := saved["attacks"].([]any)[0].(map[string]any)
	burst := saved["actions"].([]any)[1].(map[string]any)
	cure := saved["actions"].([]any)[0].(map[string]any)
	potion := saved["items"].([]any)[0].(map[string]any)
	if sword["to_hit"] != float64(5) || sword["damage_modifier"] != float64(3) || burst["save_dc"] != float64(8) || cure["dice_modifier"] != float64(1) || potion["quantity"] != float64(1) {
		t.Fatalf("hero lists should resolve: %+v", saved)
	}
	empty := map[string]any{"attacks": []any{}, "actions": []any{}, "items": []any{}}
	if status := statusOf(t, player, "PATCH", a.server.URL+goblinActions, empty); status != 403 {
		t.Fatalf("player edited NPC actions: %d", status)
	}
	if status := statusOf(t, dm, "PATCH", a.server.URL+heroActions, empty); status != 403 {
		t.Fatalf("DM edited a player's sheet actions: %d", status)
	}
	banana := map[string]any{"attacks": []map[string]any{{"id": "x", "name": "Fruit", "range_m": 1, "damage": "banana"}}, "actions": []any{}, "items": []any{}}
	if status := statusOf(t, player, "PATCH", a.server.URL+heroActions, banana); status != 400 {
		t.Fatalf("invalid damage accepted: %d", status)
	}
	if status := statusOf(t, player, "PATCH", a.server.URL+heroActions, map[string]any{"attacks": []any{}}); status != 400 {
		t.Fatalf("missing actions and items accepted: %d", status)
	}
	patch[map[string]any](t, dm, a.server.URL, goblinActions, map[string]any{"attacks": []map[string]any{{"id": "scimitar", "name": "Scimitar", "range_m": 1.5, "ability": "", "proficient": false, "attack_bonus": 4, "damage": "1d6", "damage_bonus": 2}}, "actions": []any{}, "items": []any{}})

	// Defenses and health are game master fields.
	tokenPath := func(id string) string { return a.server.URL + roomPath + "/tokens/" + id }
	if status := statusOf(t, player, "PATCH", tokenPath(goblinID), map[string]any{"armor_class": 5}); status != 403 {
		t.Fatalf("player set armor class: %d", status)
	}
	for _, bad := range []map[string]any{{"armor_class": 101}, {"resistances": []string{"banana"}}} {
		if status := statusOf(t, dm, "PATCH", tokenPath(goblinID), bad); status != 400 {
			t.Fatalf("invalid defenses %v accepted: %d", bad, status)
		}
	}
	for id, body := range map[string]map[string]any{
		goblinID: {"hit_points": 50, "max_hit_points": 50, "armor_class": 1},
		orcID:    {"hit_points": 30, "max_hit_points": 30, "resistances": []string{"fire", "fire"}},
		heroID:   {"hit_points": 5, "max_hit_points": 10},
	} {
		if status := statusOf(t, dm, "PATCH", tokenPath(id), body); status != 204 {
			t.Fatalf("DM token patch %v: %d", body, status)
		}
	}

	playerState := get[map[string]any](t, player, a.server.URL, roomPath+"/state")
	h := entityByID(t, playerState["visibleTokens"], heroID)
	if len(h["attacks"].([]any)) != 2 || len(h["actions"].([]any)) != 2 || len(h["items"].([]any)) != 1 || h["actions_editable"] != true || h["can_act"] != true ||
		h["death_saves"] == nil || h["defenses"] == nil {
		t.Fatalf("player should see, edit and act with the hero: %+v", h)
	}
	g := entityByID(t, playerState["visibleTokens"], goblinID)
	for _, key := range []string{"attacks", "actions", "items", "can_act", "defenses", "hit_points"} {
		if _, leaked := g[key]; leaked {
			t.Fatalf("player received NPC %s: %+v", key, g)
		}
	}
	if _, leaked := g["attributes"].(map[string]any)["attacks"]; leaked {
		t.Fatalf("player received raw NPC attacks: %+v", g)
	}
	dmToken := func(id string) map[string]any {
		t.Helper()
		return entityByID(t, get[map[string]any](t, dm, a.server.URL, roomPath+"/state")["visibleTokens"], id)
	}
	if g := dmToken(goblinID); len(g["attacks"].([]any)) != 1 || g["actions_editable"] != true || g["can_act"] != true {
		t.Fatalf("DM should see and edit goblin attacks: %+v", g)
	}
	if h := dmToken(heroID); len(h["attacks"].([]any)) != 2 || h["actions_editable"] != nil || h["attributes"].(map[string]any)["actions"] != nil {
		t.Fatalf("DM should see but not edit hero actions: %+v", h)
	}
	if d := dmToken(orcID)["defenses"].(map[string]any); d["armor_class"] != nil || len(d["resistances"].([]any)) != 1 {
		t.Fatalf("orc defenses: %+v", d)
	}

	dmWS := dialWS(t, a, dm, room["id"].(string))
	defer dmWS.Close()
	pWS := dialWS(t, a, player, room["id"].(string))
	defer pWS.Close()
	readType(t, dmWS, "state.snapshot")
	readType(t, pWS, "state.snapshot")
	expectError := func(typ, id, code string, body map[string]any) {
		t.Helper()
		sendWS(t, pWS, typ, id, body)
		ev := readType(t, pWS, "error")
		if ev["requestId"] != id || ev["body"].(map[string]any)["code"] != code {
			t.Fatalf("%s: want %s, got %+v", id, code, ev)
		}
	}
	act := func(source, id string, extra map[string]any) map[string]any {
		body := map[string]any{"sourceTokenId": heroID, "source": source, "actionId": id}
		maps.Copy(body, extra)
		return body
	}
	expectError("action.resolve", "orc-out-of-range", "out_of_range", act("attack", "sword", map[string]any{"targetTokenId": orcID}))
	expectError("action.resolve", "troll-behind-wall", "blocked_target", act("attack", "bow", map[string]any{"targetTokenId": troll["id"]}))
	expectError("action.resolve", "goblin-not-yours", "forbidden", map[string]any{"sourceTokenId": goblinID, "source": "attack", "actionId": "scimitar", "targetTokenId": heroID})
	expectError("action.resolve", "unknown-attack", "unknown_action", act("attack", "axe", map[string]any{"targetTokenId": goblinID}))
	expectError("action.resolve", "sword-self", "invalid_target", act("attack", "sword", map[string]any{"targetTokenId": heroID}))
	expectError("action.resolve", "no-target", "invalid_target", act("attack", "sword", nil))
	expectError("action.resolve", "no-point", "no_point", act("action", "burst", nil))
	expectError("action.resolve", "bad-source", "bad_json", act("spell", "burst", nil))
	expectError("death.save", "not-dying", "not_dying", map[string]any{"tokenId": heroID})
	expectError("check.quick", "bad-check", "invalid_check", map[string]any{"tokenId": heroID, "kind": "attribute", "key": "speed_m"})

	// Every roll is broadcast, so drain it from both sockets to keep them in step.
	roll := func(conn *websocket.Conn, typ, id string, body map[string]any) (string, map[string]any) {
		t.Helper()
		sendWS(t, conn, typ, id, body)
		var out map[string]any
		for _, c := range []*websocket.Conn{dmWS, pWS} {
			ev := readType(t, c, "roll.result")
			if ev["requestId"] != id {
				t.Fatalf("%s: unexpected roll %s", id, fmtBody(ev))
			}
			out = ev["body"].(map[string]any)
		}
		r := out["roll"].(map[string]any)
		if action, ok := r["action"].(map[string]any); ok {
			return out["body"].(string), action
		}
		return out["body"].(string), r
	}
	hp := func(id string) float64 { t.Helper(); return dmToken(id)["hit_points"].(float64) }
	num := func(m map[string]any, key string) float64 { v, _ := m[key].(float64); return v }

	body, action := roll(pWS, "check.quick", "stealth", map[string]any{"tokenId": heroID, "kind": "skill", "key": "stealth"})
	if body != "Hero: Stealth check" || action["expression"] != "1d20+1" {
		t.Fatalf("quick check: %q %+v", body, action)
	}

	body, action = roll(pWS, "action.resolve", "hero-sword", act("attack", "sword", map[string]any{"targetTokenId": goblinID}))
	target := action["targets"].([]any)[0].(map[string]any)
	if body != "Hero attacks Goblin with Sword" || action["source"] != "attack" || target["roll"].(map[string]any)["expression"] != "1d20+5" {
		t.Fatalf("sword: %q %+v", body, action)
	}
	goblinHP := 50.0
	switch target["result"] {
	case "hit", "critical":
		if action["effect"] == nil || num(target, "damage") != num(action["effect"].(map[string]any), "total") {
			t.Fatalf("hit should report its damage roll: %+v", action)
		}
		goblinHP -= num(target, "damage")
	case "miss":
		if target["roll"].(map[string]any)["dice"].([]any)[0].(map[string]any)["values"].([]any)[0] != float64(1) {
			t.Fatalf("only a natural 1 misses armor class 1: %+v", target)
		}
	default:
		t.Fatalf("unexpected sword result: %+v", target)
	}
	if got := hp(goblinID); got != goblinHP {
		t.Fatalf("goblin HP %v, want %v after %+v", got, goblinHP, target)
	}

	body, action = roll(pWS, "action.resolve", "burst", act("action", "burst", map[string]any{"point": map[string]float64{"x": 3, "y": 1.5}}))
	targets := action["targets"].([]any)
	if body != "Hero uses Burst" || len(targets) != 2 || action["dc"] != float64(8) || action["uses_left"] != float64(0) || action["effect"] == nil {
		t.Fatalf("burst should catch the goblin and the orc: %q %+v", body, action)
	}
	first, second := targets[0].(map[string]any), targets[1].(map[string]any)
	if first["name"] != "Goblin" || second["name"] != "Orc" || second["defense"] != "resistant" || first["defense"] != nil {
		t.Fatalf("burst targets: %+v", targets)
	}
	if got := hp(goblinID); got != goblinHP-num(first, "damage") {
		t.Fatalf("goblin HP %v after burst %+v", got, first)
	}
	if got := hp(orcID); got != 30-num(second, "damage") {
		t.Fatalf("orc HP %v after burst %+v", got, second)
	}
	expectError("action.resolve", "burst-again", "no_uses", act("action", "burst", map[string]any{"point": map[string]float64{"x": 3, "y": 1.5}}))

	_, action = roll(pWS, "action.resolve", "potion", act("item", "potion", map[string]any{"targetTokenId": heroID}))
	target = action["targets"].([]any)[0].(map[string]any)
	if target["result"] != "healed" || action["quantity_left"] != float64(0) || hp(heroID) != 5+num(target, "healing") || num(target, "healing") < 4 {
		t.Fatalf("potion should heal the hero: %+v", action)
	}
	expectError("action.resolve", "potion-gone", "unknown_action", act("item", "potion", map[string]any{"targetTokenId": heroID}))
	_, action = roll(pWS, "action.resolve", "cure-self", act("action", "cure", map[string]any{"targetTokenId": heroID}))
	if action["targets"].([]any)[0].(map[string]any)["result"] != "healed" || action["uses_left"] != nil {
		t.Fatalf("a heal may target its caster: %+v", action)
	}

	body, action = roll(dmWS, "action.resolve", "goblin-scimitar", map[string]any{"sourceTokenId": goblinID, "source": "attack", "actionId": "scimitar", "targetTokenId": heroID})
	if body != "Goblin attacks Hero with Scimitar" || action["targets"].([]any)[0].(map[string]any)["roll"].(map[string]any)["expression"] != "1d20+4" {
		t.Fatalf("goblin scimitar: %q %+v", body, action)
	}
	patch[map[string]any](t, dm, a.server.URL, "/api/maps/"+gm["id"].(string)+"/structures/"+wall["id"].(string), map[string]any{"pass_rules": map[string]bool{"attacks": true}})
	body, _ = roll(pWS, "action.resolve", "troll-through-wall", act("attack", "bow", map[string]any{"targetTokenId": troll["id"]}))
	if body != "Hero attacks Troll with Bow" {
		t.Fatalf("bow through an open wall: %q", body)
	}

	// A dying hero cannot act, but makes death saves.
	if status := statusOf(t, dm, "PATCH", tokenPath(heroID), map[string]any{"hit_points": 0, "max_hit_points": 10}); status != 204 {
		t.Fatalf("down the hero: %d", status)
	}
	expectError("action.resolve", "down-sword", "source_down", act("attack", "sword", map[string]any{"targetTokenId": goblinID}))
	body, action = roll(pWS, "death.save", "death-save", map[string]any{"tokenId": heroID})
	target = action["targets"].([]any)[0].(map[string]any)
	saves := dmToken(heroID)["death_saves"].(map[string]any)
	nat := target["roll"].(map[string]any)["total"].(float64)
	switch target["result"] {
	case "success":
		if nat < 10 || saves["successes"] != float64(1) {
			t.Fatalf("success: %+v %+v", target, saves)
		}
	case "failure":
		if want := map[bool]float64{true: 2, false: 1}[nat == 1]; nat >= 10 || saves["failures"] != want {
			t.Fatalf("failure: %+v %+v", target, saves)
		}
	case "revived":
		if nat != 20 || hp(heroID) != 1 {
			t.Fatalf("revived: %+v", target)
		}
	default:
		t.Fatalf("unexpected death save: %+v", target)
	}
	if body != "Hero makes a death saving throw" || action["kind"] != "death_save" {
		t.Fatalf("death save: %q %+v", body, action)
	}
}

func TestRoomStructurePlacementAndRemovalStayInRoom(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "build-dm@example.com")
	player, _ := login(t, a, "build-player@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Build Rules", "attributes": map[string]any{}, "is_public": true})
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "data": map[string]any{}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Build Table", "rule_book_id": rb["id"]})
	other := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Other Table", "rule_book_id": rb["id"]})
	roomPath, otherPath := "/api/rooms/"+room["id"].(string), "/api/rooms/"+other["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Shared Arena", "width_m": 10, "height_m": 10})
	mapPath := "/api/maps/" + gm["id"].(string)
	wall := post[map[string]any](t, dm, a.server.URL, mapPath+"/structures", map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 8, "y": 0}, {"x": 8, "y": 10}}, "blocks_vision": false, "blocks_movement": true, "blocks_attacks": true, "cover_bonus": 0, "pass_rules": map[string]bool{}})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})
	post[map[string]any](t, dm, a.server.URL, otherPath+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})
	hero := post[map[string]any](t, player, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Hero", "x_m": 1, "y_m": 1})

	dmWS := dialWS(t, a, dm, room["id"].(string))
	defer dmWS.Close()
	pWS := dialWS(t, a, player, room["id"].(string))
	defer pWS.Close()
	readType(t, dmWS, "state.snapshot")
	readType(t, pWS, "state.snapshot")
	expectError := func(conn *websocket.Conn, typ, id, code string, body any) {
		t.Helper()
		sendWS(t, conn, typ, id, body)
		ev := readType(t, conn, "error")
		if ev["requestId"] != id || ev["body"].(map[string]any)["code"] != code {
			t.Fatalf("%s: want %s, got %+v", id, code, ev)
		}
	}
	structureIDs := func(c *http.Client, path string) map[string]bool {
		t.Helper()
		state := get[map[string]any](t, c, a.server.URL, path)
		ids := map[string]bool{}
		for _, row := range state["structures"].([]any) {
			ids[row.(map[string]any)["id"].(string)] = true
		}
		return ids
	}
	barrier := map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 2, "y": 0}, {"x": 2, "y": 3}}, "blocks_vision": true, "blocks_movement": true, "blocks_attacks": true}

	expectError(pWS, "structure.create", "player-build", "forbidden", barrier)
	expectError(dmWS, "structure.create", "bad-kind", "invalid_structure", map[string]any{"kind": "lava", "geometry": barrier["geometry"]})
	expectError(dmWS, "structure.create", "one-point", "invalid_structure", map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 2, "y": 0}}})
	sendWS(t, dmWS, "structure.create", "dm-build", barrier)
	created := readType(t, pWS, "structure.created")["body"].(map[string]any)["structure"].(map[string]any)
	placedID := created["id"].(string)
	readType(t, dmWS, "structure.created")
	if created["kind"] != "wall" || created["is_hidden"] != false {
		t.Fatalf("placed structure should be a visible wall: %+v", created)
	}
	if ids := structureIDs(player, roomPath+"/state"); !ids[placedID] || !ids[wall["id"].(string)] {
		t.Fatalf("player should see the placed and the map wall: %v", ids)
	}
	if ids := structureIDs(dm, otherPath+"/state"); ids[placedID] || !ids[wall["id"].(string)] {
		t.Fatalf("placed structure leaked into another room on the same map: %v", ids)
	}
	if ids := structureIDs(dm, mapPath); len(ids) != 1 || !ids[wall["id"].(string)] {
		t.Fatalf("placed structure leaked into the source map: %v", ids)
	}
	if status := statusOf(t, dm, "PATCH", a.server.URL+mapPath+"/structures/"+placedID, map[string]any{"kind": "door"}); status != 404 {
		t.Fatalf("map editor should not reach room-placed structures: %d", status)
	}

	expectError(pWS, "token.move", "through-placed-wall", "blocked_movement", map[string]any{"tokenId": hero["id"], "to": map[string]float64{"x": 3, "y": 1}, "path": []map[string]float64{{"x": 1, "y": 1}, {"x": 3, "y": 1}}})
	sendWS(t, dmWS, "structure.move", "move-placed", map[string]any{"structureId": placedID, "geometry": []map[string]float64{{"x": 4, "y": 0}, {"x": 4, "y": 3}}})
	readType(t, pWS, "structure.moved")
	sendWS(t, pWS, "token.move", "past-moved-wall", map[string]any{"tokenId": hero["id"], "to": map[string]float64{"x": 3, "y": 1}, "path": []map[string]float64{{"x": 1, "y": 1}, {"x": 3, "y": 1}}})
	readType(t, pWS, "token.moved")
	// A group move is checked along each token's walked path, so walking around a wall's end is allowed.
	expectError(pWS, "tokens.move", "group-through-wall", "blocked_movement", map[string]any{"moves": []map[string]any{
		{"tokenId": hero["id"], "to": map[string]float64{"x": 5, "y": 1}},
	}})
	sendWS(t, pWS, "tokens.move", "group-around-wall", map[string]any{"moves": []map[string]any{
		{"tokenId": hero["id"], "to": map[string]float64{"x": 5, "y": 1}, "path": []map[string]float64{{"x": 3, "y": 1}, {"x": 3, "y": 4}, {"x": 5, "y": 4}, {"x": 5, "y": 1}}},
	}})
	readType(t, pWS, "token.moved")

	expectError(pWS, "structure.remove", "player-remove", "forbidden", map[string]any{"structureId": placedID})
	sendWS(t, dmWS, "structure.remove", "remove-placed", map[string]any{"structureId": placedID})
	if body := readType(t, pWS, "structure.removed")["body"].(map[string]any); body["structure_id"] != placedID {
		t.Fatalf("wrong structure removed: %+v", body)
	}
	expectError(dmWS, "structure.remove", "remove-again", "not_found", map[string]any{"structureId": placedID})
	sendWS(t, dmWS, "structure.remove", "remove-map-wall", map[string]any{"structureId": wall["id"]})
	readType(t, pWS, "structure.removed")
	if ids := structureIDs(player, roomPath+"/state"); len(ids) != 0 {
		t.Fatalf("removed structures still in the room: %v", ids)
	}
	if ids := structureIDs(dm, mapPath); !ids[wall["id"].(string)] {
		t.Fatalf("removing at the table deleted the source map wall: %v", ids)
	}
	if ids := structureIDs(dm, otherPath+"/state"); !ids[wall["id"].(string)] {
		t.Fatalf("removing in one room removed the wall from another room: %v", ids)
	}
	sendWS(t, pWS, "token.move", "past-removed-wall", map[string]any{"tokenId": hero["id"], "to": map[string]float64{"x": 9, "y": 1}, "path": []map[string]float64{{"x": 3, "y": 1}, {"x": 9, "y": 1}}})
	readType(t, pWS, "token.moved")
}

func TestOneShotRoomStartsMapsOnTheFly(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "oneshot-dm@example.com")
	player, _ := login(t, a, "oneshot-player@example.com")
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "One Shot"})
	roomPath := "/api/rooms/" + room["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	dmWS := dialWS(t, a, dm, room["id"].(string))
	defer dmWS.Close()
	pWS := dialWS(t, a, player, room["id"].(string))
	defer pWS.Close()
	readType(t, dmWS, "state.snapshot")
	readType(t, pWS, "state.snapshot")
	// The DM sees every structure; players only see what their tokens can see.
	activeMap := func() map[string]any {
		t.Helper()
		state := get[map[string]any](t, dm, a.server.URL, roomPath+"/state")
		active, _ := state["activeMap"].(map[string]any)
		if active == nil {
			t.Fatalf("room should have an active map: %+v", state["activeMap"])
		}
		active["structure_count"] = len(state["structures"].([]any))
		return active
	}

	sendWS(t, dmWS, "structure.create", "first-wall", map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 1, "y": 5}, {"x": 5, "y": 5}}, "blocks_vision": true, "blocks_movement": true, "blocks_attacks": true})
	readType(t, pWS, "map.activated")
	readType(t, pWS, "structure.created")
	started := activeMap()
	if started["name"] != "One Shot map" || started["width_m"] != float64(30) || started["height_m"] != float64(30) || started["structure_count"] != 1 {
		t.Fatalf("placing a structure without a map should start a 30 m map holding it: %+v", started)
	}
	library := get[[]map[string]any](t, dm, a.server.URL, "/api/maps")
	if len(library) != 1 || library[0]["id"] != started["map_id"] {
		t.Fatalf("the started map should be in the DM's library: %+v", library)
	}

	if status := statusOf(t, player, "POST", a.server.URL+roomPath+"/maps/new", map[string]any{}); status != 403 {
		t.Fatalf("player started a room map: %d", status)
	}
	for _, bad := range []map[string]any{{"width_m": 0}, {"height_m": 5000}, {"width_m": 4, "height_m": 4, "grid_size_m": 5}} {
		if status := statusOf(t, dm, "POST", a.server.URL+roomPath+"/maps/new", bad); status != 400 {
			t.Fatalf("invalid blank map %v accepted: %d", bad, status)
		}
	}
	cave := post[map[string]any](t, dm, a.server.URL, roomPath+"/maps/new", map[string]any{"name": "Cave", "width_m": 12, "height_m": 8})
	readType(t, pWS, "map.activated")
	if active := activeMap(); active["map_id"] != cave["id"] || active["name"] != "Cave" || active["width_m"] != float64(12) || active["grid_size_m"] != float64(1) || active["structure_count"] != 0 {
		t.Fatalf("new blank map should be active and empty: %+v", active)
	}

	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": started["map_id"], "is_active": true})
	readType(t, pWS, "map.activated")
	if active := activeMap(); active["map_id"] != started["map_id"] || active["structure_count"] != 1 {
		t.Fatalf("switching back should restore the first map and its placed wall: %+v", active)
	}
}

func TestRoomCheckPrompts(t *testing.T) {
	a := newTestApp(t)
	const dndID = "00000000-0000-4000-8000-000000000005"
	dm, _ := login(t, a, "checks-dm@example.com")
	alice, au := login(t, a, "checks-alice@example.com")
	bob, bu := login(t, a, "checks-bob@example.com")
	carol, cu := login(t, a, "checks-carol@example.com")
	aliceID, bobID, carolID := au["id"].(string), bu["id"].(string), cu["id"].(string)
	// Shadow: dexterity 16 (+3) with stealth proficiency (+2); wisdom 8 (-1), no save proficiency.
	character := func(c *http.Client, name string, data map[string]any) map[string]any {
		t.Helper()
		creation := map[string]any{"class_id": "fighter", "scores": map[string]any{"strength": 15, "dexterity": 14, "constitution": 13, "intelligence": 12, "wisdom": 10, "charisma": 8}, "choices": map[string]any{"skill_proficiencies": []string{"athletics", "perception"}}}
		sheet := post[map[string]any](t, c, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": dndID, "name": name, "creation": creation})
		return patch[map[string]any](t, c, a.server.URL, "/api/sheets/"+sheet["id"].(string), map[string]any{"data": data})
	}
	shadow := character(alice, "Shadow", map[string]any{"dexterity": 16, "wisdom": 8, "proficiency_bonus": 2, "skill_proficiencies": map[string]any{"stealth": true}})
	brute := character(bob, "Brute", map[string]any{"dexterity": 10})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Checks", "rule_book_id": dndID})
	roomID := room["id"].(string)
	post[map[string]any](t, alice, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"], "sheet_id": shadow["id"]})
	post[map[string]any](t, bob, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"], "sheet_id": brute["id"]})
	post[map[string]any](t, carol, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	dmWS, aWS, bWS, cWS := dialWS(t, a, dm, roomID), dialWS(t, a, alice, roomID), dialWS(t, a, bob, roomID), dialWS(t, a, carol, roomID)
	for _, conn := range []*websocket.Conn{dmWS, aWS, bWS, cWS} {
		defer conn.Close()
		readType(t, conn, "state.snapshot")
	}
	expectError := func(conn *websocket.Conn, id, code string, body map[string]any, typ string) {
		t.Helper()
		sendWS(t, conn, typ, id, body)
		if ev := readType(t, conn, "error"); ev["requestId"] != id || ev["body"].(map[string]any)["code"] != code {
			t.Fatalf("%s: expected %s, got %s", id, code, fmtBody(ev))
		}
	}
	checksFor := func(c *http.Client) []any {
		t.Helper()
		return get[map[string]any](t, c, a.server.URL, "/api/rooms/"+roomID+"/state")["checks"].([]any)
	}
	chatFor := func(c *http.Client) string {
		t.Helper()
		b, _ := json.Marshal(get[map[string]any](t, c, a.server.URL, "/api/rooms/"+roomID+"/state")["chatHistory"])
		return string(b)
	}
	// Sockets keep earlier events queued, so wait for the event caused by a given request.
	readReply := func(conn *websocket.Conn, typ, requestID string) map[string]any {
		t.Helper()
		for {
			if ev := readType(t, conn, typ); ev["requestId"] == requestID {
				return ev
			}
		}
	}
	both := []string{aliceID, bobID}
	expectError(aWS, "player-prompt", "forbidden", map[string]any{"kind": "skill", "key": "stealth", "dc": 10, "targetUserIds": both}, "check.prompt")
	expectError(dmWS, "no-character", "invalid_target", map[string]any{"kind": "skill", "key": "stealth", "dc": 10, "targetUserIds": []string{aliceID, carolID}}, "check.prompt")
	expectError(dmWS, "bad-skill", "invalid_check", map[string]any{"kind": "skill", "key": "dexterity", "dc": 10, "targetUserIds": both}, "check.prompt")
	expectError(dmWS, "bad-dc", "invalid_check", map[string]any{"kind": "ability", "key": "dexterity", "dc": 0, "targetUserIds": both}, "check.prompt")

	// Public encounter: everyone sees the prompt and every result.
	sendWS(t, dmWS, "check.prompt", "ambush", map[string]any{"title": "Goblin ambush", "kind": "skill", "key": "stealth", "dc": 1, "targetUserIds": both})
	if ev := readReply(cWS, "chat.message", "ambush"); ev["body"].(map[string]any)["body"] != "Goblin ambush: Stealth check (DC 1) for Brute, Shadow" {
		t.Fatalf("unexpected announcement: %s", fmtBody(ev))
	}
	readReply(cWS, "check.changed", "ambush")
	ambush := checksFor(carol)[0].(map[string]any)
	if ambush["label"] != "Stealth check" || ambush["title"] != "Goblin ambush" || len(ambush["targets"].([]any)) != 2 || ambush["closed_at"] != nil {
		t.Fatalf("bystander should see the open public check: %+v", ambush)
	}
	ambushID := ambush["id"].(string)
	expectError(cWS, "not-asked", "not_found", map[string]any{"checkId": ambushID}, "check.roll")
	expectError(aWS, "roll-for-bob", "forbidden", map[string]any{"checkId": ambushID, "userId": bobID}, "check.roll")
	sendWS(t, aWS, "check.roll", "alice-stealth", map[string]any{"checkId": ambushID})
	ev := readReply(cWS, "roll.result", "alice-stealth")
	result := ev["body"].(map[string]any)
	roll := result["roll"].(map[string]any)
	outcome := roll["check"].(map[string]any)
	if result["body"] != "Shadow: Stealth check (DC 1), success" || roll["expression"] != "1d20+5" || outcome["success"] != true || outcome["dc"] != float64(1) || outcome["user_id"] != aliceID || outcome["check_id"] != ambushID {
		t.Fatalf("unexpected public check result: %s", fmtBody(ev))
	}
	expectError(aWS, "alice-again", "already_rolled", map[string]any{"checkId": ambushID}, "check.roll")
	sendWS(t, dmWS, "check.roll", "dm-rolls-bob", map[string]any{"checkId": ambushID, "userId": bobID})
	if ev := readReply(aWS, "roll.result", "dm-rolls-bob"); ev["body"].(map[string]any)["roll"].(map[string]any)["check"].(map[string]any)["user_id"] != bobID {
		t.Fatalf("DM roll should be for Bob: %s", fmtBody(ev))
	}
	if ambush := checksFor(carol)[0].(map[string]any); ambush["closed_at"] == nil {
		t.Fatalf("check should close once every target rolled: %+v", ambush)
	}
	expectError(bWS, "bob-after-dm", "already_rolled", map[string]any{"checkId": ambushID}, "check.roll")

	// Private check: only targets and the DM see it, and each target only their own result.
	sendWS(t, dmWS, "check.prompt", "will", map[string]any{"kind": "save", "key": "wisdom", "dc": 100, "targetUserIds": both, "isPrivate": true})
	if ev := readReply(aWS, "chat.message", "will"); ev["body"].(map[string]any)["body"] != "Wisdom saving throw (DC 100), privately" {
		t.Fatalf("private announcement should not name the other targets: %s", fmtBody(ev))
	}
	// Events arrive in publish order: everything the bystander gets before this public marker
	// would have come from the private prompt.
	sendWS(t, dmWS, "chat.send", "public-marker", map[string]any{"text": "after the private prompt"})
	for {
		var ev map[string]any
		_ = cWS.SetReadDeadline(time.Now().Add(5 * time.Second))
		if err := cWS.ReadJSON(&ev); err != nil {
			t.Fatalf("bystander did not receive the public marker: %v", err)
		}
		if ev["requestId"] == "will" {
			t.Fatalf("bystander received the private prompt: %s %s", ev["type"], fmtBody(ev))
		}
		if ev["requestId"] == "public-marker" {
			break
		}
	}
	if checks := checksFor(carol); len(checks) != 1 {
		t.Fatalf("bystander should only see the public check, got %d", len(checks))
	}
	var willID string
	for _, item := range checksFor(alice) {
		if check := item.(map[string]any); check["is_private"] == true {
			willID = check["id"].(string)
			if targets := check["targets"].([]any); len(targets) != 1 || targets[0].(map[string]any)["user_id"] != aliceID {
				t.Fatalf("private target should only see their own row: %+v", targets)
			}
		}
	}
	sendWS(t, aWS, "check.roll", "alice-will", map[string]any{"checkId": willID})
	ev = readReply(dmWS, "roll.result", "alice-will")
	roll = ev["body"].(map[string]any)["roll"].(map[string]any)
	if roll["expression"] != "1d20-1" || roll["check"].(map[string]any)["success"] != false || ev["body"].(map[string]any)["recipient_user_ids"].([]any)[0] != aliceID {
		t.Fatalf("unexpected private check result: %s", fmtBody(ev))
	}
	readReply(aWS, "roll.result", "alice-will")
	if history := chatFor(bob); strings.Contains(history, "Shadow: Wisdom saving throw") {
		t.Fatalf("another target saw a private result: %s", history)
	}
	if history := chatFor(carol); strings.Contains(history, "Wisdom saving throw") {
		t.Fatalf("bystander saw the private check in chat: %s", history)
	}
	if !strings.Contains(chatFor(dm), "Shadow: Wisdom saving throw (DC 100), failure") {
		t.Fatal("DM should see the private result")
	}
	for _, item := range checksFor(dm) {
		if check := item.(map[string]any); check["id"] == willID && len(check["targets"].([]any)) != 2 {
			t.Fatalf("DM should see every target of a private check: %+v", check)
		}
	}
	expectError(aWS, "player-close", "forbidden", map[string]any{"checkId": willID}, "check.close")
	sendWS(t, dmWS, "check.close", "close-will", map[string]any{"checkId": willID})
	readReply(bWS, "check.changed", "close-will")
	expectError(bWS, "bob-late", "check_closed", map[string]any{"checkId": willID}, "check.roll")
}

func TestRuleBookMonsters(t *testing.T) {
	a := newTestApp(t)
	const dndID = "00000000-0000-4000-8000-000000000005"
	dm, _ := login(t, a, "monsters-dm@example.com")
	player, _ := login(t, a, "monsters-player@example.com")

	builtIn := get[map[string]any](t, dm, a.server.URL, "/api/rule-books/"+dndID)
	if monsters := builtIn["monsters"].([]any); len(monsters) != 12 {
		t.Fatalf("built-in book should ship 12 SRD monsters, got %d", len(monsters))
	}

	goblin := map[string]any{"id": "goblin", "name": "Goblin", "size_m": 1.5, "stats": map[string]any{"hit_points": 7}}
	custom := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Homebrew", "monsters": []any{goblin}})
	if monsters := custom["monsters"].([]any); len(monsters) != 1 || monsters[0].(map[string]any)["name"] != "Goblin" {
		t.Fatalf("custom monsters did not round trip: %+v", custom["monsters"])
	}
	if status := statusOf(t, dm, "POST", a.server.URL+"/api/rule-books", map[string]any{"name": "Bad", "monsters": []any{map[string]any{"id": "Bad ID", "name": "x", "size_m": 1}}}); status != 400 {
		t.Fatalf("invalid monster id: status %d", status)
	}
	renamed := patch[map[string]any](t, dm, a.server.URL, "/api/rule-books/"+custom["id"].(string), map[string]any{"name": "Homebrew 2"})
	if len(renamed["monsters"].([]any)) != 1 {
		t.Fatal("patching without monsters must keep them")
	}
	cleared := patch[map[string]any](t, dm, a.server.URL, "/api/rule-books/"+custom["id"].(string), map[string]any{"monsters": []any{}})
	if len(cleared["monsters"].([]any)) != 0 {
		t.Fatal("patching monsters should replace them")
	}

	creation := map[string]any{"class_id": "fighter", "scores": map[string]any{"strength": 15, "dexterity": 14, "constitution": 13, "intelligence": 12, "wisdom": 10, "charisma": 8}, "choices": map[string]any{"skill_proficiencies": []string{"athletics", "perception"}}}
	hero := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": dndID, "name": "Hero", "creation": creation})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Cave", "rule_book_id": dndID})
	roomPath := "/api/rooms/" + room["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"], "sheet_id": hero["id"]})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps/new", map[string]any{"name": "Cave", "width_m": 12, "height_m": 8})

	if status := statusOf(t, player, "GET", a.server.URL+roomPath+"/monsters", nil); status != 403 {
		t.Fatalf("players must not list monsters: status %d", status)
	}
	if monsters := get[[]any](t, dm, a.server.URL, roomPath+"/monsters"); len(monsters) != 12 {
		t.Fatalf("DM should list the room book's monsters, got %d", len(monsters))
	}
	if status := statusOf(t, player, "POST", a.server.URL+roomPath+"/tokens", map[string]any{"monster_id": "goblin", "sheet_id": hero["id"]}); status != 403 {
		t.Fatalf("players must not place monsters: status %d", status)
	}
	if status := statusOf(t, dm, "POST", a.server.URL+roomPath+"/tokens", map[string]any{"monster_id": "goblin", "sheet_id": hero["id"]}); status != 400 {
		t.Fatalf("a token cannot be both a sheet and a monster: status %d", status)
	}
	if status := statusOf(t, dm, "POST", a.server.URL+roomPath+"/tokens", map[string]any{"monster_id": "dragon"}); status != 400 {
		t.Fatalf("unknown monster: status %d", status)
	}
	first := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"monster_id": "goblin", "x_m": 3, "y_m": 1})
	second := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"monster_id": "goblin", "x_m": 5, "y_m": 5})
	named := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"monster_id": "ogre", "name": "Grug", "x_m": 9, "y_m": 6})
	if first["name"] != "Goblin" || second["name"] != "Goblin 2" || named["name"] != "Grug" || first["size_m"] != 1.5 || named["size_m"] != float64(3) {
		t.Fatalf("unexpected monster tokens: %+v %+v %+v", first, second, named)
	}
	heroToken := post[map[string]any](t, player, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": hero["id"], "name": "Hero", "x_m": 2, "y_m": 1})

	dmState := get[map[string]any](t, dm, a.server.URL, roomPath+"/state")
	placed := entityByID(t, dmState["visibleTokens"], first["id"].(string))
	attacks := placed["attacks"].([]any)
	if placed["attributes"].(map[string]any)["hit_points"] != float64(7) || len(attacks) != 2 || attacks[0].(map[string]any)["to_hit"] != float64(4) || placed["actions_editable"] != true {
		t.Fatalf("DM should see the goblin's stats and resolved attacks: %+v", placed)
	}
	playerState := get[map[string]any](t, player, a.server.URL, roomPath+"/state")
	for _, monster := range []map[string]any{first, second, named} {
		for _, row := range playerState["visibleTokens"].([]any) {
			token := row.(map[string]any)
			if token["id"] != monster["id"] {
				continue
			}
			attributes, _ := token["attributes"].(map[string]any)
			_, hp := token["hit_points"]
			_, maxHP := token["max_hit_points"]
			_, statHP := attributes["hit_points"]
			if hp || maxHP || statHP {
				t.Fatalf("players must not receive monster health: %+v", token)
			}
		}
	}
	if encoded, _ := json.Marshal(playerState); strings.Contains(string(encoded), "Nimble") {
		t.Fatalf("players must not receive monster stat blocks: %s", encoded)
	}

	dmWS := dialWS(t, a, dm, room["id"].(string))
	defer dmWS.Close()
	readType(t, dmWS, "state.snapshot")
	sendWS(t, dmWS, "action.resolve", "goblin-scimitar", map[string]any{"sourceTokenId": first["id"], "source": "attack", "actionId": "scimitar", "targetTokenId": heroToken["id"]})
	ev := readType(t, dmWS, "roll.result")
	body := ev["body"].(map[string]any)
	target := body["roll"].(map[string]any)["action"].(map[string]any)["targets"].([]any)[0].(map[string]any)
	effect, _ := body["roll"].(map[string]any)["action"].(map[string]any)["effect"].(map[string]any)
	if body["body"] != "Goblin attacks Hero with Scimitar" || target["roll"].(map[string]any)["expression"] != "1d20+4" ||
		effect != nil && effect["expression"] != "1d6+2" && effect["expression"] != "2d6+2" {
		t.Fatalf("placed goblin should attack with its SRD scimitar: %s", fmtBody(ev))
	}
}

func TestRuleBookCompendium(t *testing.T) {
	a := newTestApp(t)
	const dndID = "00000000-0000-4000-8000-000000000005"
	dm, _ := login(t, a, "compendium-dm@example.com")
	player, _ := login(t, a, "compendium-player@example.com")
	stranger, _ := login(t, a, "compendium-stranger@example.com")

	builtIn := get[map[string]any](t, dm, a.server.URL, "/api/rule-books/"+dndID)
	compendium := builtIn["compendium"].(map[string]any)
	if len(compendium["attacks"].([]any)) != 42 || len(compendium["actions"].([]any)) != 18 || len(compendium["items"].([]any)) != 5 {
		t.Fatalf("built-in compendium sizes: %d %d %d", len(compendium["attacks"].([]any)), len(compendium["actions"].([]any)), len(compendium["items"].([]any)))
	}
	if id := at(t, compendium, "attacks", 0, "id"); id != "club" {
		t.Fatalf("first SRD weapon: %v", id)
	}
	var fighterKit any
	for _, class := range at(t, builtIn, "creation_rules", "classes").([]any) {
		if class.(map[string]any)["id"] == "fighter" {
			fighterKit = at(t, class, "starting_equipment", "attacks")
		}
	}
	if !reflect.DeepEqual(fighterKit, []any{"longsword", "light_crossbow"}) {
		t.Fatalf("fighter kit: %v", fighterKit)
	}
	if got := orderKeys(t, at(t, builtIn["key_order"], "compendium", "children", "attacks", "items", 0)); !reflect.DeepEqual(got[:2], []string{"id", "name"}) {
		t.Fatalf("compendium weapon key order: %v", got)
	}

	axe := map[string]any{"id": "axe", "name": "Axe", "range_m": 1.5, "ability": "strength", "proficient": true, "attack_bonus": 0, "damage": "1d6", "damage_bonus": 0, "damage_type": "slashing"}
	banana := map[string]any{"id": "axe", "name": "Axe", "range_m": 1.5, "damage": "banana"}
	book := func(kit ...string) map[string]any {
		return map[string]any{
			"name": "Brute Rules", "is_public": true,
			"compendium":     map[string]any{"attacks": []any{axe}, "actions": []any{}, "items": []any{}},
			"creation_rules": map[string]any{"classes": []any{map[string]any{"id": "brute", "name": "Brute", "defaults": map[string]any{}, "starting_equipment": map[string]any{"attacks": kit}}}},
		}
	}
	custom := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", book("axe"))
	bookPath := a.server.URL + "/api/rule-books/" + custom["id"].(string)
	if status, code := errorOf(t, dm, "POST", a.server.URL+"/api/rule-books", book("sword")); status != 400 || code != "invalid_rules" {
		t.Fatalf("kit outside the compendium: %d %s", status, code)
	}
	bad := book()
	bad["compendium"] = map[string]any{"attacks": []any{banana}}
	if status, code := errorOf(t, dm, "POST", a.server.URL+"/api/rule-books", bad); status != 400 || code != "invalid_compendium" {
		t.Fatalf("invalid compendium weapon: %d %s", status, code)
	}
	renamed := patch[map[string]any](t, dm, a.server.URL, "/api/rule-books/"+custom["id"].(string), map[string]any{"name": "x"})
	if id := at(t, renamed, "compendium", "attacks", 0, "id"); id != "axe" {
		t.Fatalf("a patch without a compendium should keep it: %v", renamed["compendium"])
	}
	emptied := map[string]any{"compendium": map[string]any{"attacks": []any{}, "actions": []any{}, "items": []any{}}}
	if status, code := errorOf(t, dm, "PATCH", bookPath, emptied); status != 400 || code != "invalid_rules" {
		t.Fatalf("removing a kit weapon from the compendium: %d %s", status, code)
	}

	sheetBody := func(attack map[string]any) map[string]any {
		return map[string]any{"rule_book_id": custom["id"], "name": "Grok", "creation": map[string]any{"class_id": "brute"}, "data": map[string]any{"attacks": []any{attack}}}
	}
	if status, code := errorOf(t, player, "POST", a.server.URL+"/api/sheets", sheetBody(banana)); status != 400 || code != "invalid_actions" {
		t.Fatalf("sheet with invalid attack: %d %s", status, code)
	}
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", sheetBody(axe))
	if id := at(t, sheet, "data", "attacks", 0, "id"); id != "axe" {
		t.Fatalf("sheet attacks: %v", sheet["data"])
	}
	sheetPath := a.server.URL + "/api/sheets/" + sheet["id"].(string)
	if status, code := errorOf(t, player, "PATCH", sheetPath, map[string]any{"data": map[string]any{"attacks": []any{banana}}}); status != 400 || code != "invalid_actions" {
		t.Fatalf("sheet patch with invalid attack: %d %s", status, code)
	}

	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Pit", "rule_book_id": custom["id"]})
	roomPath := "/api/rooms/" + room["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps/new", map[string]any{"name": "Pit", "width_m": 10, "height_m": 10})
	token := post[map[string]any](t, player, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Grok", "x_m": 1, "y_m": 1})

	lists := map[string]any{"attacks": []any{axe}, "actions": []any{}, "items": []any{map[string]any{"id": "p", "name": "Potion", "kind": "heal", "range_m": 1.5, "dice": "2d4", "quantity": 1}}}
	saved := patch[map[string]any](t, player, a.server.URL, "/api/sheets/"+sheet["id"].(string)+"/actions", lists)
	if q := at(t, saved, "data", "items", 0, "quantity"); q != float64(1) {
		t.Fatalf("sheet actions patch: %v", saved["data"])
	}
	if status, _ := errorOf(t, stranger, "PATCH", sheetPath+"/actions", lists); status != 404 {
		t.Fatalf("another user edited the sheet: %d", status)
	}
	if status, code := errorOf(t, player, "PATCH", sheetPath+"/actions", map[string]any{"attacks": []any{}, "actions": []any{}}); status != 400 || code != "invalid_actions" {
		t.Fatalf("missing items: %d %s", status, code)
	}
	held := entityByID(t, get[map[string]any](t, player, a.server.URL, roomPath+"/state")["visibleTokens"], token["id"].(string))
	if name := at(t, held, "items", 0, "name"); name != "Potion" {
		t.Fatalf("room token should show the sheet's new items: %+v", held)
	}
}

func TestRoomTokenControls(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "controls-dm@example.com")
	playerA, ua := login(t, a, "controls-a@example.com")
	playerB, _ := login(t, a, "controls-b@example.com")
	aID := ua["id"].(string)
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Control Rules", "attributes": map[string]any{}, "is_public": true})
	sheet := post[map[string]any](t, playerA, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "data": map[string]any{}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Controls", "rule_book_id": rb["id"]})
	roomID := room["id"].(string)
	roomPath := "/api/rooms/" + roomID
	post[map[string]any](t, playerA, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	post[map[string]any](t, playerB, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Yard", "width_m": 10, "height_m": 10})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})

	request := func(c *http.Client, method, path string, body any) (int, map[string]any) {
		t.Helper()
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, a.server.URL+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	errorCode := func(out map[string]any) any {
		e, _ := out["error"].(map[string]any)
		return e["code"]
	}
	expectStatus := func(c *http.Client, method, path string, body any, want int) map[string]any {
		t.Helper()
		status, out := request(c, method, path, body)
		if status != want {
			t.Fatalf("%s %s %v: want %d, got %d %+v", method, path, body, want, status, out)
		}
		return out
	}
	stateToken := func(c *http.Client, id string) map[string]any {
		t.Helper()
		return entityByID(t, get[map[string]any](t, c, a.server.URL, roomPath+"/state")["visibleTokens"], id)
	}

	heroBody := map[string]any{"sheet_id": sheet["id"], "name": "Hero", "x_m": 1, "y_m": 1}
	hero := expectStatus(playerA, "POST", roomPath+"/tokens", heroBody, 201)
	if out := expectStatus(playerA, "POST", roomPath+"/tokens", heroBody, 409); errorCode(out) != "token_limit" {
		t.Fatalf("second character should hit the token limit: %+v", out)
	}
	goblin := expectStatus(dm, "POST", roomPath+"/tokens", map[string]any{"name": "Goblin", "x_m": 3, "y_m": 2}, 201)
	heroPath, goblinPath := roomPath+"/tokens/"+hero["id"].(string), roomPath+"/tokens/"+goblin["id"].(string)

	// Health: only the game master sets it; a sheet-backed token writes it to the sheet.
	expectStatus(playerA, "PATCH", heroPath, map[string]any{"hit_points": 5}, 403)
	expectStatus(dm, "PATCH", heroPath, map[string]any{"hit_points": 5, "max_hit_points": 10}, 204)
	if data := get[map[string]any](t, playerA, a.server.URL, "/api/sheets/"+sheet["id"].(string))["data"].(map[string]any); data["hit_points"] != float64(5) {
		t.Fatalf("health should be written to the sheet: %+v", data)
	}
	if token := stateToken(playerA, hero["id"].(string)); token["hit_points"] != float64(5) || token["max_hit_points"] != float64(10) {
		t.Fatalf("owner should see the token's health: %+v", token)
	}
	expectStatus(dm, "PATCH", heroPath, map[string]any{"max_hit_points": -1}, 400)

	dmWS, aWS, bWS := dialWS(t, a, dm, roomID), dialWS(t, a, playerA, roomID), dialWS(t, a, playerB, roomID)
	for _, conn := range []*websocket.Conn{dmWS, aWS, bWS} {
		defer conn.Close()
		readType(t, conn, "state.snapshot")
	}
	readReply := func(conn *websocket.Conn, typ, requestID string) map[string]any {
		t.Helper()
		for {
			if ev := readType(t, conn, typ); ev["requestId"] == requestID {
				return ev
			}
		}
	}
	expectError := func(conn *websocket.Conn, typ, id, code string, body any) {
		t.Helper()
		sendWS(t, conn, typ, id, body)
		if ev := readType(t, conn, "error"); ev["requestId"] != id || ev["body"].(map[string]any)["code"] != code {
			t.Fatalf("%s: want %s, got %+v", id, code, ev)
		}
	}

	// Movers: the game master lets another player move a token, without sharing its other rights.
	expectError(aWS, "token.move", "move-goblin", "forbidden", map[string]any{"tokenId": goblin["id"], "to": map[string]float64{"x": 4, "y": 2}})
	expectStatus(dm, "PATCH", goblinPath, map[string]any{"mover_user_ids": []string{aID}}, 204)
	if token := stateToken(playerA, goblin["id"].(string)); token["can_move"] != true || token["mover_user_ids"] != nil {
		t.Fatalf("a mover should be able to move the goblin without seeing the mover list: %+v", token)
	}
	if movers, _ := stateToken(dm, goblin["id"].(string))["mover_user_ids"].([]any); len(movers) != 1 || movers[0] != aID {
		t.Fatalf("the game master should see the goblin's movers: %+v", movers)
	}
	sendWS(t, aWS, "tokens.move", "group-move", map[string]any{"moves": []map[string]any{
		{"tokenId": hero["id"], "to": map[string]float64{"x": 2.5, "y": 1.5}},
		{"tokenId": goblin["id"], "to": map[string]float64{"x": 3.5, "y": 2.5}},
	}})
	readReply(aWS, "token.moved", "group-move")
	if token := stateToken(dm, hero["id"].(string)); token["x_m"] != 2.5 || token["y_m"] != 1.5 {
		t.Fatalf("group move did not move the hero: %+v", token)
	}
	if token := stateToken(dm, goblin["id"].(string)); token["x_m"] != 3.5 || token["y_m"] != 2.5 {
		t.Fatalf("group move did not move the goblin: %+v", token)
	}
	expectStatus(dm, "PATCH", goblinPath, map[string]any{"mover_user_ids": []string{"7f0c6d1e-2b4a-4c39-9a51-0d8e3f6b2c17"}}, 400)

	// Removal: owners remove their own tokens, movers do not.
	expectError(bWS, "token.remove", "b-removes-hero", "forbidden", map[string]any{"tokenId": hero["id"]})
	expectError(aWS, "token.remove", "a-removes-goblin", "forbidden", map[string]any{"tokenId": goblin["id"]})
	sendWS(t, aWS, "token.remove", "a-removes-hero", map[string]any{"tokenId": hero["id"]})
	if body := readReply(dmWS, "token.removed", "a-removes-hero")["body"].(map[string]any); body["token_id"] != hero["id"] {
		t.Fatalf("wrong token removed: %+v", body)
	}
	hero = expectStatus(playerA, "POST", roomPath+"/tokens", heroBody, 201)
	heroPath = roomPath + "/tokens/" + hero["id"].(string)

	// Images: the owner uploads one and puts it on their token.
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	var upload bytes.Buffer
	form := multipart.NewWriter(&upload)
	part, _ := form.CreatePart(textproto.MIMEHeader{"Content-Disposition": {`form-data; name="file"; filename="hero.png"`}, "Content-Type": {"image/png"}})
	_, _ = part.Write(png)
	_ = form.WriteField("name", "hero.png")
	_ = form.WriteField("kind", "token")
	_ = form.Close()
	uploadReq, _ := http.NewRequest("POST", a.server.URL+"/api/assets", &upload)
	uploadReq.Header.Set("Content-Type", form.FormDataContentType())
	res, err := playerA.Do(uploadReq)
	if err != nil {
		t.Fatal(err)
	}
	var asset map[string]any
	_ = json.NewDecoder(res.Body).Decode(&asset)
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("upload: status %d %+v", res.StatusCode, asset)
	}
	assetID := asset["id"].(string)
	res, err = playerA.Get(a.server.URL + "/api/assets/" + assetID)
	if err != nil {
		t.Fatal(err)
	}
	served, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || !bytes.Equal(served, png) {
		t.Fatalf("asset should be served as uploaded: status %d type %q, %d bytes", res.StatusCode, res.Header.Get("Content-Type"), len(served))
	}
	expectStatus(playerA, "PATCH", heroPath, map[string]any{"image_asset_id": assetID}, 204)
	if token := stateToken(playerA, hero["id"].(string)); token["image_asset_id"] != assetID {
		t.Fatalf("token should carry its image: %+v", token)
	}
	if out := expectStatus(dm, "PATCH", goblinPath, map[string]any{"image_asset_id": assetID}, 400); errorCode(out) != "invalid_image" {
		t.Fatalf("only the uploader may use an image: %+v", out)
	}
	expectStatus(playerA, "PATCH", heroPath, map[string]any{"image_asset_id": nil}, 204)
	if token := stateToken(playerA, hero["id"].(string)); token["image_asset_id"] != nil {
		t.Fatalf("null should clear the token's image: %+v", token)
	}
	res, err = http.Get(a.server.URL + "/api/assets/" + assetID)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("assets need a session: status %d", res.StatusCode)
	}
}

func TestRoomTokenDragStreaming(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "drag-dm@example.com")
	playerA, _ := login(t, a, "drag-a@example.com")
	playerB, _ := login(t, a, "drag-b@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Drag Rules", "attributes": map[string]any{}, "is_public": true})
	sheetA := post[map[string]any](t, playerA, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "data": map[string]any{}})
	sheetB := post[map[string]any](t, playerB, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Scout", "data": map[string]any{}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Drag", "rule_book_id": rb["id"]})
	roomID := room["id"].(string)
	roomPath := "/api/rooms/" + roomID
	post[map[string]any](t, playerA, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	post[map[string]any](t, playerB, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Field", "width_m": 20, "height_m": 20})
	post[map[string]any](t, dm, a.server.URL, "/api/maps/"+gm["id"].(string)+"/structures", map[string]any{"kind": "wall", "geometry": []map[string]float64{{"x": 5, "y": 0}, {"x": 5, "y": 20}}, "blocks_vision": false, "blocks_movement": true, "blocks_attacks": true, "cover_bonus": 0, "pass_rules": map[string]bool{}})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})
	hero := post[map[string]any](t, playerA, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheetA["id"], "name": "Hero", "x_m": 1, "y_m": 1})
	post[map[string]any](t, playerB, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheetB["id"], "name": "Scout", "x_m": 1, "y_m": 18})
	goblin := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"name": "Goblin", "x_m": 3, "y_m": 1})
	lurker := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"name": "Lurker", "x_m": 2, "y_m": 2})
	heroID, goblinID, lurkerID := hero["id"].(string), goblin["id"].(string), lurker["id"].(string)

	dmWS, aWS, bWS := dialWS(t, a, dm, roomID), dialWS(t, a, playerA, roomID), dialWS(t, a, playerB, roomID)
	for _, conn := range []*websocket.Conn{dmWS, aWS, bWS} {
		defer conn.Close()
		readType(t, conn, "state.snapshot")
	}
	sendWS(t, dmWS, "token.visibility", "hide-lurker", map[string]any{"tokenId": lurkerID, "isHidden": true})
	if ev := readType(t, dmWS, "token.updated"); ev["requestId"] != "hide-lurker" {
		t.Fatalf("lurker was not hidden: %+v", ev)
	}

	// A chat marker sent after a frame on the same connection is published after it, so the
	// events before the marker are everything that frame produced.
	mark := func(conn *websocket.Conn, id string) {
		t.Helper()
		sendWS(t, conn, "chat.send", id, map[string]any{"text": id})
	}
	until := func(conn *websocket.Conn, id string) []map[string]any {
		t.Helper()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		var events []map[string]any
		for {
			var ev map[string]any
			if err := conn.ReadJSON(&ev); err != nil {
				t.Fatalf("waiting for marker %s: %v", id, err)
			}
			if body, _ := ev["body"].(map[string]any); ev["type"] == "chat.message" && body["body"] == id {
				return events
			}
			events = append(events, ev)
		}
	}
	ofType := func(events []map[string]any, typ string) []map[string]any {
		var out []map[string]any
		for _, ev := range events {
			if ev["type"] == typ {
				out = append(out, ev)
			}
		}
		return out
	}
	move := func(id string, x, y float64) map[string]any {
		return map[string]any{"tokenId": id, "to": map[string]float64{"x": x, "y": y}}
	}
	drag := func(conn *websocket.Conn, moves ...map[string]any) {
		t.Helper()
		sendWS(t, conn, "token.drag", "", map[string]any{"moves": moves})
	}
	endedIDs := func(ev map[string]any) string {
		b, _ := json.Marshal(ev["body"].(map[string]any)["token_ids"])
		return string(b)
	}

	// 1. A player sees only the dragged tokens visible to them; the dragger gets no echo.
	drag(dmWS, move(goblinID, 3.25, 1.5), move(lurkerID, 2.5, 2.5))
	mark(dmWS, "m1")
	frames := ofType(until(aWS, "m1"), "token.dragging")
	if len(frames) != 1 {
		t.Fatalf("player A should get one drag frame, got %+v", frames)
	}
	if got, want := fmtBody(frames[0]), `{"moves":[{"token_id":"`+goblinID+`","x":3.25,"y":1.5}],"room_id":"`+roomID+`"}`; got != want {
		t.Fatalf("player A frame: got %s, want %s", got, want)
	}
	if frames := ofType(until(bWS, "m1"), "token.dragging"); len(frames) != 0 {
		t.Fatalf("player B sees neither token: %+v", frames)
	}
	if frames := ofType(until(dmWS, "m1"), "token.dragging"); len(frames) != 0 {
		t.Fatalf("the dragger should not get its own frame: %+v", frames)
	}

	// 2. The game master sees a player's drag.
	drag(aWS, move(heroID, 2.5, 1.5))
	mark(aWS, "m2")
	if frames := ofType(until(dmWS, "m2"), "token.dragging"); len(frames) != 1 || !strings.Contains(fmtBody(frames[0]), heroID) {
		t.Fatalf("game master should see the hero drag: %+v", frames)
	}
	if frames := ofType(until(aWS, "m2"), "token.dragging"); len(frames) != 0 {
		t.Fatalf("the dragger should not get its own frame: %+v", frames)
	}

	// 3. A token the player may not move is ignored without an error.
	drag(aWS, move(goblinID, 4, 4))
	mark(aWS, "m3")
	if frames := ofType(until(dmWS, "m3"), "token.dragging"); len(frames) != 0 {
		t.Fatalf("a forbidden drag should not be relayed: %+v", frames)
	}
	if errs := ofType(until(aWS, "m3"), "error"); len(errs) != 0 {
		t.Fatalf("a forbidden drag should not reply with an error: %+v", errs)
	}

	// 4. A blocked drop ends the live drag.
	drag(aWS, move(heroID, 6.5, 1.5))
	sendWS(t, aWS, "token.move", "blocked", move(heroID, 6.5, 1.5))
	if ev := readType(t, aWS, "error"); ev["requestId"] != "blocked" || ev["body"].(map[string]any)["code"] != "blocked_movement" {
		t.Fatalf("want blocked_movement, got %+v", ev)
	}
	if ids := endedIDs(readType(t, dmWS, "token.drag.ended")); ids != `["`+heroID+`"]` {
		t.Fatalf("blocked drop should end the hero drag: %s", ids)
	}

	// 5. Cancelling ends the live drag.
	drag(aWS, move(heroID, 2.5, 1.5))
	sendWS(t, aWS, "token.drag.end", "", map[string]any{})
	if ids := endedIDs(readType(t, dmWS, "token.drag.ended")); ids != `["`+heroID+`"]` {
		t.Fatalf("cancel should end the hero drag: %s", ids)
	}

	// 6. A successful drop replaces the drag with token.moved.
	drag(aWS, move(heroID, 2.5, 1.5))
	sendWS(t, aWS, "token.move", "landed", move(heroID, 2.5, 1.5))
	mark(aWS, "m6")
	events := until(dmWS, "m6")
	moved := ofType(events, "token.moved")
	if len(moved) != 1 || moved[0]["requestId"] != "landed" || endedIDs(moved[0]) != `["`+heroID+`"]` {
		t.Fatalf("want one token.moved for the hero, got %+v", moved)
	}
	if ended := ofType(events, "token.drag.ended"); len(ended) != 0 {
		t.Fatalf("a landed drag should not also end: %+v", ended)
	}

	// 7. Disconnecting mid-drag ends the live drag.
	drag(aWS, move(heroID, 3.5, 1.5))
	mark(aWS, "m7")
	until(dmWS, "m7")
	aWS.Close()
	if ids := endedIDs(readType(t, dmWS, "token.drag.ended")); ids != `["`+heroID+`"]` {
		t.Fatalf("disconnect should end the hero drag: %s", ids)
	}
}

func TestRoomRulerSharingAndSpeed(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "ruler-dm@example.com")
	player, playerUser := login(t, a, "ruler-player@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Ruler Rules", "attributes": map[string]any{}, "is_public": true})
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "data": map[string]any{"speed_m": 9}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Ruler", "rule_book_id": rb["id"]})
	roomID := room["id"].(string)
	roomPath := "/api/rooms/" + roomID
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Field", "width_m": 20, "height_m": 20})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})
	hero := post[map[string]any](t, player, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Hero", "x_m": 1, "y_m": 1})
	goblin := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"name": "Goblin", "x_m": 3, "y_m": 1, "attributes": map[string]any{"speed_m": 6}})

	// Movers get the walking speed; a player never gets it for a token they cannot move.
	speeds := func(c *http.Client) map[string]any {
		t.Helper()
		out := map[string]any{}
		for _, raw := range get[map[string]any](t, c, a.server.URL, roomPath+"/state")["visibleTokens"].([]any) {
			token := raw.(map[string]any)
			out[token["id"].(string)] = token["speed_m"]
		}
		return out
	}
	if got := speeds(player); got[hero["id"].(string)] != float64(9) || got[goblin["id"].(string)] != nil {
		t.Fatalf("player speeds: %+v", got)
	}
	if got := speeds(dm); got[hero["id"].(string)] != float64(9) || got[goblin["id"].(string)] != float64(6) {
		t.Fatalf("game master speeds: %+v", got)
	}

	dmWS, playerWS := dialWS(t, a, dm, roomID), dialWS(t, a, player, roomID)
	for _, conn := range []*websocket.Conn{dmWS, playerWS} {
		defer conn.Close()
		readType(t, conn, "state.snapshot")
	}
	sendWS(t, playerWS, "ruler.measure", "r1", map[string]any{"from": map[string]float64{"x": 1, "y": 1}, "to": map[string]float64{"x": 4, "y": 5}})
	shown := readType(t, dmWS, "ruler.shown")["body"].(map[string]any)
	if shown["user_id"] != playerUser["id"] || shown["meters"] != float64(5) || shown["conn_id"] == "" || shown["room_id"] != roomID {
		t.Fatalf("the table should see the player's ruler: %+v", shown)
	}
	sendWS(t, playerWS, "ruler.clear", "r2", map[string]any{})
	if cleared := readType(t, dmWS, "ruler.cleared")["body"].(map[string]any); cleared["conn_id"] != shown["conn_id"] {
		t.Fatalf("clearing should name the same ruler: %+v", cleared)
	}
	// The measurer gets no echo of its own ruler.
	sendWS(t, playerWS, "chat.send", "mark", map[string]any{"text": "mark"})
	_ = playerWS.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var ev map[string]any
		if err := playerWS.ReadJSON(&ev); err != nil {
			t.Fatal(err)
		}
		if ev["type"] == "ruler.shown" || ev["type"] == "ruler.cleared" {
			t.Fatalf("the measurer should not get its own ruler back: %+v", ev)
		}
		if ev["type"] == "chat.message" {
			break
		}
	}
	// A ruler still held when the measurer disconnects is taken off the table.
	sendWS(t, playerWS, "ruler.measure", "r3", map[string]any{"from": map[string]float64{"x": 1, "y": 1}, "to": map[string]float64{"x": 2, "y": 1}})
	readType(t, dmWS, "ruler.shown")
	playerWS.Close()
	if cleared := readType(t, dmWS, "ruler.cleared")["body"].(map[string]any); cleared["conn_id"] != shown["conn_id"] {
		t.Fatalf("disconnect should clear the ruler: %+v", cleared)
	}
}

func dialWS(t *testing.T, a *testApp, c *http.Client, roomID string) *websocket.Conn {
	t.Helper()
	return dialPath(t, a, c, "/api/rooms/"+roomID+"/ws")
}
func dialPath(t *testing.T, a *testApp, c *http.Client, path string) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(a.server.URL, "http") + path
	hdr := http.Header{}
	parsed, _ := url.Parse(a.server.URL)
	for _, ck := range c.Jar.Cookies(parsed) {
		hdr.Add("Cookie", ck.String())
	}
	conn, _, err := websocket.DefaultDialer.Dial(u, hdr)
	if err != nil {
		t.Fatal(err)
	}
	return conn
}
func sendWS(t *testing.T, c *websocket.Conn, typ, id string, body any) {
	t.Helper()
	if err := c.WriteJSON(map[string]any{"type": typ, "requestId": id, "body": body}); err != nil {
		t.Fatal(err)
	}
}
func readType(t *testing.T, c *websocket.Conn, typ string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_ = c.SetReadDeadline(time.Now().Add(time.Second))
		var ev map[string]any
		if err := c.ReadJSON(&ev); err == nil {
			if ev["type"] == typ {
				return ev
			}
		}
	}
	t.Fatalf("did not read event %s", typ)
	return nil
}
func fmtBody(ev map[string]any) string { b, _ := json.Marshal(ev["body"]); return string(b) }

func entityByID(t *testing.T, value any, id string) map[string]any {
	t.Helper()
	rows, ok := value.([]any)
	if !ok {
		t.Fatalf("expected entity rows, got %T", value)
	}
	for _, value := range rows {
		row, ok := value.(map[string]any)
		if ok && row["id"] == id {
			return row
		}
	}
	t.Fatalf("entity %s not found in %+v", id, rows)
	return nil
}
