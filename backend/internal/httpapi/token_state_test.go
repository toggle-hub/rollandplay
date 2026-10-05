package httpapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"github.com/gorilla/websocket"
)

func TestRoomTokenStatusConditionsAndRest(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "status-dm@example.com")
	playerA, _ := login(t, a, "status-a@example.com")
	playerB, _ := login(t, a, "status-b@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Status Rules", "attributes": map[string]any{}, "is_public": true})
	sheet := post[map[string]any](t, playerA, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "data": map[string]any{
		"hit_points": 10, "max_hit_points": 10,
		"actions": []map[string]any{{"id": "bless", "name": "Bless", "kind": "heal", "range_m": 9, "dice": "1d4", "uses": map[string]any{"max": 2, "remaining": 0}}},
	}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Status", "rule_book_id": rb["id"]})
	roomID := room["id"].(string)
	roomPath := "/api/rooms/" + roomID
	post[map[string]any](t, playerA, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	post[map[string]any](t, playerB, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	gm := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Camp", "width_m": 10, "height_m": 10})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": gm["id"], "is_active": true})

	expectStatus := func(c *http.Client, method, path string, body any, want int) {
		t.Helper()
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, a.server.URL+path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != want {
			t.Fatalf("%s %s %v: want %d, got %d", method, path, body, want, res.StatusCode)
		}
	}
	stateToken := func(c *http.Client, id string) map[string]any {
		t.Helper()
		return entityByID(t, get[map[string]any](t, c, a.server.URL, roomPath+"/state")["visibleTokens"], id)
	}
	hero := post[map[string]any](t, playerA, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Hero", "x_m": 1, "y_m": 1})
	goblin := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"name": "Goblin", "x_m": 2, "y_m": 1, "attributes": map[string]any{"hit_points": 7, "max_hit_points": 7}})
	heroID, goblinID := hero["id"].(string), goblin["id"].(string)
	heroPath, goblinPath := roomPath+"/tokens/"+heroID, roomPath+"/tokens/"+goblinID
	// Player B's own character lets them see the others through the fog.
	sheetB := post[map[string]any](t, playerB, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Scout", "data": map[string]any{}})
	post[map[string]any](t, playerB, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheetB["id"], "name": "Scout", "x_m": 3, "y_m": 1})

	// Sides are per viewer: your own character, another player's, or the game master's.
	if side := stateToken(playerA, heroID)["side"]; side != "own" {
		t.Fatalf("the hero is the owner's own token, got %v", side)
	}
	if side := stateToken(playerB, heroID)["side"]; side != "party" {
		t.Fatalf("the hero is in another player's party, got %v", side)
	}
	if side := stateToken(playerB, goblinID)["side"]; side != "npc" {
		t.Fatalf("the goblin is an NPC, got %v", side)
	}

	// Conditions: everyone sees them; the game master and the token's owner set them.
	expectStatus(dm, "PATCH", goblinPath, map[string]any{"conditions": []string{"Prone", "prone", " Hexed "}}, 204)
	if got := stateToken(playerB, goblinID)["conditions"]; !slices.Equal(anyStrings(got), []string{"prone", "Hexed"}) {
		t.Fatalf("players should see the goblin's conditions: %v", got)
	}
	expectStatus(playerA, "PATCH", heroPath, map[string]any{"conditions": []string{"concentrating"}}, 204)
	expectStatus(playerB, "PATCH", heroPath, map[string]any{"conditions": []string{}}, 403)
	expectStatus(playerA, "PATCH", goblinPath, map[string]any{"conditions": []string{}}, 403)
	expectStatus(playerA, "PATCH", heroPath, map[string]any{"temporary_hit_points": 3}, 403)

	// Temporary HP and death saves are game master edits; death saves need a sheet.
	expectStatus(dm, "PATCH", heroPath, map[string]any{"temporary_hit_points": 5}, 204)
	if temp := stateToken(playerA, heroID)["temporary_hit_points"]; temp != float64(5) {
		t.Fatalf("the owner should see temporary HP: %v", temp)
	}
	expectStatus(dm, "PATCH", goblinPath, map[string]any{"death_save_failures": 1}, 400)
	expectStatus(dm, "PATCH", heroPath, map[string]any{"death_save_failures": 4}, 400)

	dmWS, aWS, bWS := dialWS(t, a, dm, roomID), dialWS(t, a, playerA, roomID), dialWS(t, a, playerB, roomID)
	for _, conn := range []*websocket.Conn{dmWS, aWS, bWS} {
		defer conn.Close()
		readType(t, conn, "state.snapshot")
	}
	reply := func(conn *websocket.Conn, typ, id string) map[string]any {
		t.Helper()
		for {
			if ev := readType(t, conn, typ); ev["requestId"] == id {
				return ev
			}
		}
	}
	expectError := func(conn *websocket.Conn, typ, id, code string, body any) {
		t.Helper()
		sendWS(t, conn, typ, id, body)
		if ev := reply(conn, "error", id); ev["body"].(map[string]any)["code"] != code {
			t.Fatalf("%s: want %s, got %s", id, code, fmtBody(ev))
		}
	}

	// Quick damage and healing follow the action rules and reach everyone as a token update.
	expectError(aWS, "token.health", "player-damage", "forbidden", map[string]any{"tokenId": goblinID, "damage": 3})
	expectError(dmWS, "token.health", "both", "invalid_amount", map[string]any{"tokenId": goblinID, "damage": 3, "heal": 2})
	sendWS(t, dmWS, "token.health", "hit-goblin", map[string]any{"tokenId": goblinID, "damage": 3})
	reply(bWS, "token.updated", "hit-goblin")
	if hp := stateToken(dm, goblinID)["hit_points"]; hp != float64(4) {
		t.Fatalf("the goblin should be at 4 HP: %v", hp)
	}
	// Changing another setting leaves the damage alone.
	expectStatus(dm, "PATCH", goblinPath, map[string]any{"armor_class": 13}, 204)
	if goblin := stateToken(dm, goblinID); goblin["hit_points"] != float64(4) || goblin["defenses"].(map[string]any)["armor_class"] != float64(13) {
		t.Fatalf("an armor class change should keep the goblin's damage: %+v", goblin)
	}
	sendWS(t, dmWS, "token.health", "drop-goblin", map[string]any{"tokenId": goblinID, "damage": 10})
	reply(dmWS, "token.updated", "drop-goblin")
	if goblin := stateToken(playerB, goblinID); goblin["status"] != "down" || goblin["hit_points"] != nil || goblin["max_hit_points"] != nil {
		t.Fatalf("players should see the goblin is down without its HP: %+v", goblin)
	}
	sendWS(t, dmWS, "token.health", "hit-hero", map[string]any{"tokenId": heroID, "damage": 7})
	reply(dmWS, "token.updated", "hit-hero")
	if hero := stateToken(playerA, heroID); hero["temporary_hit_points"] != float64(0) || hero["hit_points"] != float64(8) {
		t.Fatalf("temporary HP should absorb damage first: %+v", hero)
	}

	// Three failed death saves kill; lowering them brings the character back to dying.
	expectStatus(dm, "PATCH", heroPath, map[string]any{"hit_points": 0, "death_save_failures": 3}, 204)
	if status := stateToken(playerB, heroID)["status"]; status != "dead" {
		t.Fatalf("players should see the hero is dead: %v", status)
	}
	expectError(dmWS, "token.health", "heal-dead", "dead", map[string]any{"tokenId": heroID, "heal": 5})
	expectStatus(dm, "PATCH", heroPath, map[string]any{"death_save_failures": 1, "death_save_successes": 2}, 204)
	if hero := stateToken(playerA, heroID); hero["status"] != "down" || hero["death_saves"].(map[string]any)["successes"] != float64(2) {
		t.Fatalf("the hero should be dying again: %+v", hero)
	}

	// A party long rest restores player characters only, and tells the table.
	expectError(aWS, "token.rest", "player-rest", "forbidden", map[string]any{"party": true})
	sendWS(t, dmWS, "token.rest", "party-rest", map[string]any{"party": true})
	if ev := reply(bWS, "chat.message", "party-rest"); ev["body"].(map[string]any)["kind"] != "system" {
		t.Fatalf("the rest should be announced: %s", fmtBody(ev))
	}
	reply(bWS, "token.updated", "party-rest")
	hero = stateToken(playerA, heroID)
	saves := hero["death_saves"].(map[string]any)
	uses := hero["actions"].([]any)[0].(map[string]any)["uses"].(map[string]any)
	if hero["hit_points"] != float64(10) || hero["status"] != nil || saves["successes"] != float64(0) || saves["failures"] != float64(0) || uses["remaining"] != float64(2) {
		t.Fatalf("a long rest should restore the hero: %+v", hero)
	}
	if status := stateToken(playerB, goblinID)["status"]; status != "down" {
		t.Fatalf("NPCs are not part of the party rest: %v", status)
	}
	sendWS(t, dmWS, "token.rest", "goblin-rest", map[string]any{"tokenIds": []string{goblinID}})
	reply(dmWS, "token.updated", "goblin-rest")
	if hp := stateToken(dm, goblinID)["hit_points"]; hp != float64(7) {
		t.Fatalf("a chosen token should rest too: %v", hp)
	}
}

func anyStrings(value any) []string {
	list, _ := value.([]any)
	out := make([]string, 0, len(list))
	for _, item := range list {
		s, _ := item.(string)
		out = append(out, s)
	}
	return out
}
