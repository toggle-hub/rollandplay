package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"rollandplay/backend/migrations"
)

// readUntil reads events until one matches, failing after five seconds.
func readUntil(t *testing.T, c *websocket.Conn, what string, match func(map[string]any) bool) map[string]any {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var ev map[string]any
		if err := c.ReadJSON(&ev); err != nil {
			t.Fatalf("waiting for %s: %v", what, err)
		}
		if match(ev) {
			return ev
		}
	}
}

func replyTo(id string) func(map[string]any) bool {
	return func(ev map[string]any) bool { return ev["requestId"] == id }
}

func chatBodies(messages []any) []string {
	out := make([]string, len(messages))
	for i, m := range messages {
		out[i], _ = m.(map[string]any)["body"].(string)
	}
	return out
}

func TestRoomChatRollTextWhispersAndHistory(t *testing.T) {
	a := newTestApp(t)
	dm, du := login(t, a, "chat-dm@example.com")
	player, pu := login(t, a, "chat-player@example.com")
	other, ou := login(t, a, "chat-other@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Rules", "attributes": map[string]any{}, "is_public": true})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Chatty", "rule_book_id": rb["id"]})
	roomID := room["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	post[map[string]any](t, other, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	dmWS := dialWS(t, a, dm, roomID)
	defer dmWS.Close()
	pWS := dialWS(t, a, player, roomID)
	defer pWS.Close()
	state := func(c *http.Client) map[string]any {
		return get[map[string]any](t, c, a.server.URL, "/api/rooms/"+roomID+"/state")
	}

	// A message sent with a roll keeps its text; the roll travels beside it.
	sendWS(t, pWS, "chat.send", "attack", map[string]any{"text": "I attack!", "rollExpression": "1d20+5"})
	ev := readUntil(t, dmWS, "the roll", replyTo("attack"))
	body := ev["body"].(map[string]any)
	if ev["type"] != "roll.result" || body["body"] != "I attack!" || body["roll"].(map[string]any)["expression"] != "1d20+5" {
		t.Fatalf("roll message lost its text: %s", fmtBody(ev))
	}
	history := state(other)["chatHistory"].([]any)
	if last := history[len(history)-1].(map[string]any); last["body"] != "I attack!" || last["roll"] == nil {
		t.Fatalf("stored roll message lost its text: %+v", last)
	}

	// Players whisper only the game master; only the game master and the sender see it.
	sendWS(t, pWS, "chat.send", "whisper", map[string]any{"text": "I pocket the gem", "rollExpression": "1d20", "recipientUserIds": []string{du["id"].(string)}})
	if ev := readUntil(t, dmWS, "the whisper", replyTo("whisper")); ev["type"] != "roll.result" || ev["body"].(map[string]any)["body"] != "I pocket the gem" {
		t.Fatalf("game master did not get the whisper: %s", fmtBody(ev))
	}
	for _, c := range []*http.Client{dm, player} {
		if bodies := chatBodies(state(c)["chatHistory"].([]any)); !slices.Contains(bodies, "I pocket the gem") {
			t.Fatalf("whisper missing for sender or game master: %v", bodies)
		}
	}
	if bodies := chatBodies(state(other)["chatHistory"].([]any)); slices.Contains(bodies, "I pocket the gem") {
		t.Fatalf("another player saw the whisper: %v", bodies)
	}
	sendWS(t, pWS, "chat.send", "player-to-player", map[string]any{"text": "psst", "recipientUserIds": []string{ou["id"].(string)}})
	if ev := readUntil(t, pWS, "the rejection", replyTo("player-to-player")); ev["type"] != "error" || ev["body"].(map[string]any)["code"] != "forbidden" {
		t.Fatalf("players may only whisper the game master: %s", fmtBody(ev))
	}
	sendWS(t, dmWS, "chat.send", "dm-to-stranger", map[string]any{"text": "hello", "recipientUserIds": []string{"00000000-0000-4000-8000-0000000000aa"}})
	if ev := readUntil(t, dmWS, "the rejection", replyTo("dm-to-stranger")); ev["type"] != "error" {
		t.Fatalf("whispers must stay inside the room: %s", fmtBody(ev))
	}
	sendWS(t, dmWS, "chat.send", "dm-to-player", map[string]any{"text": "you hear a voice", "recipientUserIds": []string{pu["id"].(string)}})
	if ev := readUntil(t, pWS, "the game master's whisper", replyTo("dm-to-player")); ev["type"] != "chat.message" {
		t.Fatalf("game master whisper failed: %s", fmtBody(ev))
	}

	// 250 older messages, one in ten whispered to the player: the state carries the newest 200, oldest first.
	ctx := context.Background()
	if _, err := a.pool.Exec(ctx, `insert into chat_messages(id,room_id,sender_user_id,kind,body,created_at) select gen_random_uuid(),$1,$2,'chat','old '||g,now()-interval '1 hour'+g*interval '1 second' from generate_series(1,250) g`, roomID, du["id"]); err != nil {
		t.Fatal(err)
	}
	if _, err := a.pool.Exec(ctx, `insert into chat_message_recipients(message_id,user_id) select id,$2 from chat_messages where room_id=$1 and body ~ '^old [0-9]*0$'`, roomID, pu["id"]); err != nil {
		t.Fatal(err)
	}
	dmState := state(dm)
	dmHistory := dmState["chatHistory"].([]any)
	if len(dmHistory) != 200 || dmState["chatHasEarlier"] != true {
		t.Fatalf("want the newest 200 with more to load, got %d (earlier %v)", len(dmHistory), dmState["chatHasEarlier"])
	}
	dmBodies := chatBodies(dmHistory)
	if dmBodies[len(dmBodies)-1] != "you hear a voice" || dmBodies[0] != "old 54" {
		t.Fatalf("state should end with the newest message: first %q last %q", dmBodies[0], dmBodies[len(dmBodies)-1])
	}

	// Paging back walks through the rest, oldest first, with the same visibility as the state.
	page := func(c *http.Client, before string, limit string) map[string]any {
		return get[map[string]any](t, c, a.server.URL, "/api/rooms/"+roomID+"/chat?before="+before+"&limit="+limit)
	}
	firstID := dmHistory[0].(map[string]any)["id"].(string)
	earlier := page(dm, firstID, "50")
	if bodies := chatBodies(earlier["messages"].([]any)); len(bodies) != 50 || bodies[0] != "old 4" || bodies[49] != "old 53" || earlier["hasEarlier"] != true {
		t.Fatalf("unexpected earlier page: %v hasEarlier=%v", bodies, earlier["hasEarlier"])
	}
	oldest := page(dm, earlier["messages"].([]any)[0].(map[string]any)["id"].(string), "50")
	if bodies := chatBodies(oldest["messages"].([]any)); !slices.Equal(bodies, []string{"old 1", "old 2", "old 3"}) || oldest["hasEarlier"] != false {
		t.Fatalf("unexpected oldest page: %v hasEarlier=%v", bodies, oldest["hasEarlier"])
	}
	otherHistory := state(other)["chatHistory"].([]any)
	otherEarlier := page(other, otherHistory[0].(map[string]any)["id"].(string), "200")
	for _, b := range append(chatBodies(otherHistory), chatBodies(otherEarlier["messages"].([]any))...) {
		if b == "old 10" || b == "old 250" || b == "you hear a voice" {
			t.Fatalf("another player saw a private message while paging: %q", b)
		}
	}
	if n := len(otherHistory) + len(otherEarlier["messages"].([]any)); n != 225+1 || otherEarlier["hasEarlier"] != false {
		t.Fatalf("bystander should page through every public message, got %d", n)
	}
	playerEarlier := page(player, state(player)["chatHistory"].([]any)[0].(map[string]any)["id"].(string), "200")
	if !slices.Contains(chatBodies(playerEarlier["messages"].([]any)), "old 10") {
		t.Fatal("the recipient should see their private message while paging")
	}
	res, err := other.Get(a.server.URL + "/api/rooms/" + roomID + "/chat?before=not-an-id")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad cursor status %d", res.StatusCode)
	}
	outsider, _ := login(t, a, "chat-outsider@example.com")
	res, err = outsider.Get(a.server.URL + "/api/rooms/" + roomID + "/chat")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("outsider read the chat: status %d", res.StatusCode)
	}
}

func TestChatRollBodyMigration(t *testing.T) {
	a := newTestApp(t)
	dm, du := login(t, a, "chat-migrate@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Rules", "attributes": map[string]any{}, "is_public": true})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Old rolls", "rule_book_id": rb["id"]})
	roll := `{"expression":"1d20+2","dice":[{"count":1,"sides":20,"values":[7]}],"modifier":2,"total":9}`
	ctx := context.Background()
	for _, body := range []string{roll, "Roll for initiative?", "{not json"} {
		if _, err := a.pool.Exec(ctx, `insert into chat_messages(id,room_id,sender_user_id,kind,body,roll) values(gen_random_uuid(),$1,$2,'roll',$3,$4::jsonb)`, room["id"], du["id"], body, roll); err != nil {
			t.Fatal(err)
		}
	}
	sql, err := migrations.Files.ReadFile("022_chat_roll_bodies.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.pool.Exec(ctx, string(sql)); err != nil {
		t.Fatal(err)
	}
	history := get[map[string]any](t, dm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/state")["chatHistory"].([]any)
	bodies := chatBodies(history)
	slices.Sort(bodies)
	if !slices.Equal(bodies, []string{"", "Roll for initiative?", "{not json"}) {
		raw, _ := json.Marshal(bodies)
		t.Fatalf("only roll copies should be cleared: %s", raw)
	}
}

func TestRoomPresence(t *testing.T) {
	a := newTestApp(t)
	dm, du := login(t, a, "presence-dm@example.com")
	player, pu := login(t, a, "presence-player@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Rules", "attributes": map[string]any{}, "is_public": true})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Presence", "rule_book_id": rb["id"]})
	roomID := room["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	presence := func(userID string, online bool) func(map[string]any) bool {
		return func(ev map[string]any) bool {
			body, _ := ev["body"].(map[string]any)
			return ev["type"] == "presence.changed" && body["user_id"] == userID && body["online"] == online
		}
	}
	ids := func(ev map[string]any) []string {
		var out []string
		for _, id := range ev["body"].(map[string]any)["online_user_ids"].([]any) {
			out = append(out, id.(string))
		}
		slices.Sort(out)
		return out
	}
	dmWS := dialWS(t, a, dm, roomID)
	defer dmWS.Close()
	if got := ids(readUntil(t, dmWS, "own presence", presence(du["id"].(string), true))); !slices.Equal(got, []string{du["id"].(string)}) {
		t.Fatalf("only the game master is connected: %v", got)
	}
	pWS := dialWS(t, a, player, roomID)
	want := []string{du["id"].(string), pu["id"].(string)}
	slices.Sort(want)
	if got := ids(readUntil(t, dmWS, "player online", presence(pu["id"].(string), true))); !slices.Equal(got, want) {
		t.Fatalf("both should be online: %v", got)
	}
	// A second tab keeps the player online when the first closes.
	pWS2 := dialWS(t, a, player, roomID)
	readUntil(t, dmWS, "second tab", presence(pu["id"].(string), true))
	pWS.Close()
	readUntil(t, dmWS, "first tab closed", presence(pu["id"].(string), true))
	pWS2.Close()
	if got := ids(readUntil(t, dmWS, "player offline", presence(pu["id"].(string), false))); !slices.Equal(got, []string{du["id"].(string)}) {
		t.Fatalf("player should be offline: %v", got)
	}
}
