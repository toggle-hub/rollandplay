package httpapi_test

import (
	"net/http"
	"testing"

	"github.com/gorilla/websocket"
)

func TestRoomDoorsUndoAndSavingTableChanges(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "doors-dm@example.com")
	player, _ := login(t, a, "doors-player@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Door Rules", "attributes": map[string]any{}, "is_public": true})
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "data": map[string]any{}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Door Table", "rule_book_id": rb["id"]})
	other := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Other Table", "rule_book_id": rb["id"]})
	roomPath, otherPath := "/api/rooms/"+room["id"].(string), "/api/rooms/"+other["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"]})
	keep := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Keep", "width_m": 10, "height_m": 10})
	mapPath := "/api/maps/" + keep["id"].(string)
	blocking := func(kind string, x float64) map[string]any {
		return map[string]any{"kind": kind, "geometry": []map[string]float64{{"x": x, "y": 0}, {"x": x, "y": 10}}, "blocks_vision": true, "blocks_movement": true, "blocks_attacks": true, "cover_bonus": 0, "pass_rules": map[string]bool{}}
	}
	door := post[map[string]any](t, dm, a.server.URL, mapPath+"/structures", blocking("door", 3))
	wall := post[map[string]any](t, dm, a.server.URL, mapPath+"/structures", blocking("wall", 8))
	doorID, wallID := door["id"].(string), wall["id"].(string)
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": keep["id"], "is_active": true})
	post[map[string]any](t, dm, a.server.URL, otherPath+"/maps", map[string]any{"map_id": keep["id"], "is_active": true})
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
	// Whether the hero's sight reaches past the doorway at x=3, inside the map.
	seesPastDoor := func() bool {
		t.Helper()
		state := get[map[string]any](t, player, a.server.URL, roomPath+"/state")
		area := state["visibility"].(map[string]any)["visionAreas"].([]any)[0].(map[string]any)
		for _, p := range area["polygon"].([]any) {
			point := p.(map[string]any)
			if x, y := point["x"].(float64), point["y"].(float64); x > 4 && y > 0.5 && y < 9.5 {
				return true
			}
		}
		return false
	}
	through := map[string]any{"tokenId": hero["id"], "to": map[string]float64{"x": 5, "y": 1}, "path": []map[string]float64{{"x": 1, "y": 1}, {"x": 5, "y": 1}}}

	if seesPastDoor() {
		t.Fatal("a closed door should block the hero's sight")
	}
	expectError(pWS, "token.move", "closed-door", "blocked_movement", through)
	expectError(pWS, "structure.door", "player-opens", "forbidden", map[string]any{"structureId": doorID, "isOpen": true})
	expectError(dmWS, "structure.door", "open-wall", "not_a_door", map[string]any{"structureId": wallID, "isOpen": true})
	sendWS(t, dmWS, "structure.door", "open", map[string]any{"structureId": doorID, "isOpen": true})
	if body := readType(t, pWS, "structure.updated")["body"].(map[string]any); body["structure_id"] != doorID || body["is_open"] != true {
		t.Fatalf("players should hear the door open: %+v", body)
	}
	if !seesPastDoor() {
		t.Fatal("an open door should let the hero see through")
	}
	if d := entityByID(t, get[map[string]any](t, player, a.server.URL, roomPath+"/state")["structures"], doorID); d["is_open"] != true {
		t.Fatalf("players should see the door open: %+v", d)
	}
	if d := entityByID(t, get[map[string]any](t, dm, a.server.URL, otherPath+"/state")["structures"], doorID); d["is_open"] != false {
		t.Fatalf("opening a door in one room opened it in another: %+v", d)
	}
	sendWS(t, pWS, "token.move", "open-door", through)
	readType(t, pWS, "token.moved")

	// Undo of a removal: the structure comes back as it was.
	sendWS(t, dmWS, "structure.remove", "remove-door", map[string]any{"structureId": doorID})
	readType(t, pWS, "structure.removed")
	sendWS(t, dmWS, "structure.restore", "restore-door", map[string]any{"structureId": doorID})
	readType(t, pWS, "structure.updated")
	if d := entityByID(t, get[map[string]any](t, dm, a.server.URL, roomPath+"/state")["structures"], doorID); d["is_open"] != true {
		t.Fatalf("a restored door should come back open: %+v", d)
	}
	expectError(dmWS, "structure.restore", "restore-again", "not_found", map[string]any{"structureId": doorID})
	expectError(pWS, "structure.restore", "player-restore", "forbidden", map[string]any{"structureId": doorID})

	// Table changes: place a wall, move the map wall, remove the door, and place-then-remove a scrap wall.
	sendWS(t, dmWS, "structure.create", "place", blocking("wall", 6))
	placedID := readType(t, dmWS, "structure.created")["body"].(map[string]any)["structure"].(map[string]any)["id"].(string)
	sendWS(t, dmWS, "structure.create", "scrap", blocking("cover", 2))
	scrapID := readType(t, dmWS, "structure.created")["body"].(map[string]any)["structure"].(map[string]any)["id"].(string)
	sendWS(t, dmWS, "structure.remove", "remove-scrap", map[string]any{"structureId": scrapID})
	readType(t, dmWS, "structure.removed")
	sendWS(t, dmWS, "structure.move", "move-wall", map[string]any{"structureId": wallID, "geometry": []map[string]float64{{"x": 7, "y": 0}, {"x": 7, "y": 10}}})
	readType(t, dmWS, "structure.moved")
	sendWS(t, dmWS, "structure.remove", "remove-door-for-good", map[string]any{"structureId": doorID})
	readType(t, dmWS, "structure.removed")

	roomMaps := func(c *http.Client, path string) []map[string]any {
		t.Helper()
		return get[[]map[string]any](t, c, a.server.URL, path+"/maps")
	}
	listed := roomMaps(dm, roomPath)
	if len(listed) != 1 || listed[0]["token_count"] != float64(1) || listed[0]["can_edit"] != true {
		t.Fatalf("room map list should show the keep with the hero on it: %+v", listed)
	}
	if changes := listed[0]["table_changes"].(map[string]any); changes["added"] != float64(1) || changes["moved"] != float64(1) || changes["removed"] != float64(1) {
		t.Fatalf("unsaved table changes miscounted: %+v", changes)
	}
	if status := statusOf(t, player, "GET", a.server.URL+roomPath+"/maps", nil); status != 403 {
		t.Fatalf("players should not list the room's maps: %d", status)
	}
	savePath := roomPath + "/maps/" + listed[0]["id"].(string) + "/save"
	if status, code := errorOf(t, player, "POST", a.server.URL+savePath, map[string]any{}); status != 403 || code != "forbidden" {
		t.Fatalf("a player saved table changes: %d %s", status, code)
	}

	saved := post[map[string]any](t, dm, a.server.URL, savePath, map[string]any{})
	if saved["added"] != float64(1) || saved["moved"] != float64(1) || saved["removed"] != float64(1) {
		t.Fatalf("save reported the wrong changes: %+v", saved)
	}
	readType(t, pWS, "structure.updated")
	saved = get[map[string]any](t, dm, a.server.URL, mapPath)
	structures := saved["structures"].([]any)
	if len(structures) != 2 {
		t.Fatalf("the saved map should hold the moved wall and the placed wall only: %+v", structures)
	}
	if moved := entityByID(t, structures, wallID); moved["geometry"].([]any)[0].(map[string]any)["x"] != float64(7) {
		t.Fatalf("the moved wall should be saved where it was moved: %+v", moved)
	}
	entityByID(t, structures, placedID)
	if ids := get[map[string]any](t, dm, a.server.URL, otherPath+"/state")["structures"].([]any); len(ids) != 2 {
		t.Fatalf("other rooms on the map should get the saved walls and lose the door: %+v", ids)
	}
	entityByID(t, get[map[string]any](t, dm, a.server.URL, roomPath+"/state")["structures"], placedID)
	if changes := roomMaps(dm, roomPath)[0]["table_changes"].(map[string]any); changes["added"] != float64(0) || changes["moved"] != float64(0) || changes["removed"] != float64(0) {
		t.Fatalf("nothing should be left to save: %+v", changes)
	}
	// The saved wall now belongs to the map, so the editor can change it.
	if status := statusOf(t, dm, "PATCH", a.server.URL+mapPath+"/structures/"+placedID, map[string]any{"kind": "door"}); status != 200 {
		t.Fatalf("the map editor should reach the saved wall: %d", status)
	}

	// A game master who can't edit the saved map can't save into it.
	own := post[map[string]any](t, player, a.server.URL, "/api/rooms", map[string]any{"name": "Player Table", "rule_book_id": rb["id"]})
	ownPath := "/api/rooms/" + own["id"].(string)
	post[map[string]any](t, player, a.server.URL, ownPath+"/maps", map[string]any{"map_id": keep["id"], "is_active": true})
	ownMaps := roomMaps(player, ownPath)
	if ownMaps[0]["can_edit"] != false {
		t.Fatalf("the player cannot edit the DM's map: %+v", ownMaps)
	}
	if status, code := errorOf(t, player, "POST", a.server.URL+ownPath+"/maps/"+ownMaps[0]["id"].(string)+"/save", map[string]any{}); status != 403 || code != "map_edit_forbidden" {
		t.Fatalf("saving into someone else's map: %d %s", status, code)
	}
}
