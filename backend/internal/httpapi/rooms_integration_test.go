package httpapi_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// expectClosed reads from a room socket until the server closes it normally.
func expectClosed(t *testing.T, c *websocket.Conn) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		if _, _, err := c.ReadMessage(); err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				t.Fatalf("expected a normal close, got %v", err)
			}
			return
		}
	}
}

func tokenNames(t *testing.T, c *http.Client, base, roomID string) map[string]bool {
	t.Helper()
	state := get[map[string]any](t, c, base, "/api/rooms/"+roomID+"/state")
	names := map[string]bool{}
	tokens, _ := state["visibleTokens"].([]any)
	for _, token := range tokens {
		names[token.(map[string]any)["name"].(string)] = true
	}
	return names
}

func TestRoomLeaveAndDelete(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "leave-dm@example.com")
	player, pu := login(t, a, "leave-player@example.com")
	invitee, _ := login(t, a, "leave-invitee@example.com")
	outsider, _ := login(t, a, "leave-outsider@example.com")
	for c, name := range map[*http.Client]string{dm: "Dana", player: "Pip", invitee: "Ivy", outsider: "Otto"} {
		patch[map[string]any](t, c, a.server.URL, "/api/me", map[string]string{"username": name, "pronouns": ""})
	}
	book := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Leave Rules", "attributes": map[string]any{"grit": 1}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Short Stay", "rule_book_id": book["id"]})
	roomID := room["id"].(string)
	base := a.server.URL + "/api/rooms/" + roomID
	gameMap := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Inn", "width_m": 10, "height_m": 10})
	post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/maps", map[string]any{"map_id": gameMap["id"], "is_active": true})
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": book["id"], "name": "Pip the Bold", "data": map[string]any{}})
	patch[map[string]any](t, player, a.server.URL, "/api/rooms/"+roomID+"/members/"+pu["id"].(string), map[string]any{"sheet_id": sheet["id"]})
	post[map[string]any](t, player, a.server.URL, "/api/rooms/"+roomID+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Pip the Bold"})
	dmToken := post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/tokens", map[string]any{"name": "Innkeeper"})
	patch[map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/tokens/"+dmToken["id"].(string), map[string]any{"mover_user_ids": []string{pu["id"].(string)}})
	post[map[string]any](t, dm, a.server.URL, "/api/rooms/"+roomID+"/invitations", map[string]string{"username": "Ivy"})

	byName := func(c *http.Client) map[string]map[string]any {
		out := map[string]map[string]any{}
		for _, row := range get[[]map[string]any](t, c, a.server.URL, "/api/rooms") {
			out[row["name"].(string)] = row
		}
		return out
	}
	if listed := byName(dm)["Short Stay"]; listed["player_count"] != float64(1) || listed["membership"].(map[string]any)["is_dm"] != true {
		t.Fatalf("the game master's card should count one player: %+v", listed)
	}
	if seat := byName(player)["Short Stay"]["membership"].(map[string]any); seat["is_dm"] != false || seat["sheet_name"] != "Pip the Bold" {
		t.Fatalf("the player's card should name their character: %+v", seat)
	}

	if status, code := errorOf(t, dm, "POST", base+"/leave", nil); status != 409 || code != "owner_cannot_leave" {
		t.Fatalf("the creator leaving: %d %s", status, code)
	}
	if status, code := errorOf(t, player, "DELETE", base, nil); status != 403 || code != "owner_required" {
		t.Fatalf("a player deleting the room: %d %s", status, code)
	}
	if status := statusOf(t, outsider, "DELETE", base, nil); status != 404 {
		t.Fatalf("an outsider deleting the room: %d", status)
	}
	if status := statusOf(t, outsider, "POST", base+"/leave", nil); status != 404 {
		t.Fatalf("an outsider leaving the room: %d", status)
	}

	dmRoom := dialWS(t, a, dm, roomID)
	defer dmRoom.Close()
	readType(t, dmRoom, "state.snapshot")
	playerRoom := dialWS(t, a, player, roomID)
	defer playerRoom.Close()
	readType(t, playerRoom, "state.snapshot")

	if status := statusOf(t, player, "POST", base+"/leave", nil); status != 204 {
		t.Fatalf("leave status=%d", status)
	}
	if left := readType(t, playerRoom, "member.left")["body"].(map[string]any); left["user_id"] != pu["id"] || left["room_id"] != roomID {
		t.Fatalf("member.left should name the leaver: %+v", left)
	}
	expectClosed(t, playerRoom)
	readType(t, dmRoom, "member.left")
	if status := statusOf(t, player, "GET", base, nil); status != 403 {
		t.Fatalf("a player who left still reads the room: %d", status)
	}
	if _, listed := byName(player)["Short Stay"]; listed {
		t.Fatal("a room you left should leave your list")
	}
	if names := tokenNames(t, dm, a.server.URL, roomID); names["Pip the Bold"] || !names["Innkeeper"] {
		t.Fatalf("the leaver's character leaves the map, the table's tokens stay: %v", names)
	}
	var movers int
	if err := a.pool.QueryRow(context.Background(), `select count(*) from room_token_movers where user_id=$1`, pu["id"]).Scan(&movers); err != nil || movers != 0 {
		t.Fatalf("moves granted to the leaver should end: %d %v", movers, err)
	}

	inviteeNotes := dialPath(t, a, invitee, "/api/notifications/ws")
	defer inviteeNotes.Close()
	if status := statusOf(t, dm, "DELETE", base, nil); status != 204 {
		t.Fatalf("delete status=%d", status)
	}
	readType(t, dmRoom, "room.deleted")
	expectClosed(t, dmRoom)
	if note := readNotification(t, inviteeNotes, "room_invitation.removed"); note["room"].(map[string]any)["id"] != roomID {
		t.Fatalf("the pending invitee should be told: %+v", note)
	}
	if waiting := get[map[string][]map[string]any](t, invitee, a.server.URL, "/api/notifications"); len(waiting["room_invitations"]) != 0 {
		t.Fatalf("a deleted room's invitation should be gone: %+v", waiting)
	}
	if status := statusOf(t, dm, "GET", base, nil); status != 403 {
		t.Fatalf("a deleted room is still readable: %d", status)
	}
	// The map was only placed in the room, so it stays in the library and can now be deleted.
	if status := statusOf(t, dm, "DELETE", a.server.URL+"/api/maps/"+gameMap["id"].(string), nil); status != 204 {
		t.Fatalf("map delete after its room is gone: %d", status)
	}
	if status := statusOf(t, player, "GET", a.server.URL+"/api/sheets/"+sheet["id"].(string), nil); status != 200 {
		t.Fatalf("the player's character should survive the room: %d", status)
	}
}

func TestFriendsByUsernameAndFriendsFirstInvites(t *testing.T) {
	a := newTestApp(t)
	gm, _ := login(t, a, "friendly-gm@example.com")
	bard, _ := login(t, a, "friendly-bard@example.com")
	stranger, _ := login(t, a, "friendly-stranger@example.com")
	for c, name := range map[*http.Client]string{gm: "Gale", bard: "Barda", stranger: "Bard"} {
		patch[map[string]any](t, c, a.server.URL, "/api/me", map[string]string{"username": name, "pronouns": "they/them"})
	}
	if status, code := errorOf(t, gm, "PATCH", a.server.URL+"/api/me", map[string]string{"username": "Bard"}); status != 409 || code != "username_taken" {
		t.Fatalf("taking another player's name: %d %s", status, code)
	}
	if status := statusOf(t, gm, "POST", a.server.URL+"/api/friends", map[string]string{"username": "Nobody"}); status != 404 {
		t.Fatalf("unknown username: %d", status)
	}
	request := post[map[string]any](t, gm, a.server.URL, "/api/friends", map[string]string{"username": "barda"})
	patch[map[string]any](t, bard, a.server.URL, "/api/friends/"+request["id"].(string), map[string]string{"status": "accepted"})

	room := post[map[string]any](t, gm, a.server.URL, "/api/rooms", map[string]any{"name": "Friendly Table"})
	roomID := room["id"].(string)
	friends := get[[]map[string]any](t, gm, a.server.URL, "/api/rooms/"+roomID+"/invite-candidates")
	if len(friends) != 1 || friends[0]["username"] != "Barda" || friends[0]["friend"] != true || friends[0]["invited"] != false {
		t.Fatalf("an empty search lists friends only: %+v", friends)
	}
	matches := get[[]map[string]any](t, gm, a.server.URL, "/api/rooms/"+roomID+"/invite-candidates?q=bard")
	if len(matches) != 2 || matches[0]["username"] != "Barda" || matches[1]["username"] != "Bard" || matches[1]["friend"] != false {
		t.Fatalf("friends come before other matches: %+v", matches)
	}
	post[map[string]any](t, gm, a.server.URL, "/api/rooms/"+roomID+"/invitations", map[string]string{"username": "Barda"})
	if invited := get[[]map[string]any](t, gm, a.server.URL, "/api/rooms/"+roomID+"/invite-candidates"); len(invited) != 1 || invited[0]["invited"] != true {
		t.Fatalf("an invited friend is marked: %+v", invited)
	}
}

func TestAcceptInvitationWithCharacter(t *testing.T) {
	a := newTestApp(t)
	gm, _ := login(t, a, "pick-gm@example.com")
	player, _ := login(t, a, "pick-player@example.com")
	patch[map[string]any](t, gm, a.server.URL, "/api/me", map[string]string{"username": "Greer", "pronouns": "she/her"})
	patch[map[string]any](t, player, a.server.URL, "/api/me", map[string]string{"username": "Pell", "pronouns": "he/him"})
	book := post[map[string]any](t, player, a.server.URL, "/api/rule-books", map[string]any{"name": "Shared Rules", "is_public": true, "attributes": map[string]any{"grit": 1}})
	other := post[map[string]any](t, player, a.server.URL, "/api/rule-books", map[string]any{"name": "Other Rules", "attributes": map[string]any{}})
	first := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": book["id"], "name": "First", "data": map[string]any{}})
	second := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": book["id"], "name": "Second", "data": map[string]any{}})
	wrong := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": other["id"], "name": "Wrong", "data": map[string]any{}})
	_ = first
	room := post[map[string]any](t, gm, a.server.URL, "/api/rooms", map[string]any{"name": "Picked Table", "rule_book_id": book["id"]})
	invitation := post[map[string]any](t, gm, a.server.URL, "/api/rooms/"+room["id"].(string)+"/invitations", map[string]string{"username": "Pell"})
	acceptPath := a.server.URL + "/api/room-invitations/" + invitation["id"].(string) + "/accept"
	if status, code := errorOf(t, player, "POST", acceptPath, map[string]any{"sheet_id": wrong["id"]}); status != 400 || code != "invalid_sheet" {
		t.Fatalf("accepting with another rule book's character: %d %s", status, code)
	}
	if status := statusOf(t, player, "GET", a.server.URL+"/api/rooms/"+room["id"].(string), nil); status != 403 {
		t.Fatalf("a rejected accept must not join: %d", status)
	}
	joined := post[map[string]any](t, player, a.server.URL, "/api/room-invitations/"+invitation["id"].(string)+"/accept", map[string]any{"sheet_id": second["id"]})
	if joined["sheet_id"] != second["id"] || joined["is_dm"] != false {
		t.Fatalf("accepting with a character should seat it: %+v", joined)
	}
}
