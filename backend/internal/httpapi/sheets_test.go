package httpapi_test

import (
	"net/http"
	"testing"
)

func TestSheetDataEditAndDeleteReachRooms(t *testing.T) {
	a := newTestApp(t)
	dm, _ := login(t, a, "sheet-delete-dm@example.com")
	player, playerUser := login(t, a, "sheet-delete-player@example.com")
	other, _ := login(t, a, "sheet-delete-other@example.com")
	rb := post[map[string]any](t, dm, a.server.URL, "/api/rule-books", map[string]any{"name": "Delete Rules", "attributes": map[string]any{"hit_points": 0}, "is_public": true})
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": rb["id"], "name": "Hero", "is_public": true, "data": map[string]any{"hit_points": 7}})
	sheetPath := a.server.URL + "/api/sheets/" + sheet["id"].(string)
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Farewell", "rule_book_id": rb["id"]})
	roomID := room["id"].(string)
	roomPath := "/api/rooms/" + roomID
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"], "sheet_id": sheet["id"]})
	gameMap := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Hall", "width_m": 10, "height_m": 10})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": gameMap["id"], "is_active": true})
	hero := post[map[string]any](t, player, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Hero", "x_m": 1, "y_m": 1})
	heroID := hero["id"].(string)

	dmWS := dialWS(t, a, dm, roomID)
	defer dmWS.Close()
	readType(t, dmWS, "state.snapshot")

	// Editing the sheet's data reaches the table, and data must stay an object.
	if status, code := errorOf(t, player, "PATCH", sheetPath, map[string]any{"data": "strong"}); status != 400 || code != "invalid_data" {
		t.Fatalf("non-object data: got %d %s", status, code)
	}
	edited := patch[map[string]any](t, player, a.server.URL, "/api/sheets/"+sheet["id"].(string), map[string]any{"data": map[string]any{"hit_points": 12}})
	if edited["data"].(map[string]any)["hit_points"] != float64(12) {
		t.Fatalf("data edit not saved: %+v", edited)
	}
	if ev := readType(t, dmWS, "token.updated"); ev["body"].(map[string]any)["token_id"] != heroID {
		t.Fatalf("data edit should refresh the hero token: %s", fmtBody(ev))
	}

	// Only the owner can delete, even a public sheet; others get 404.
	for _, c := range []*http.Client{other, dm} {
		if status := statusOf(t, c, "DELETE", sheetPath, nil); status != 404 {
			t.Fatalf("non-owner delete: want 404, got %d", status)
		}
	}
	if status := statusOf(t, player, "DELETE", sheetPath, nil); status != 204 {
		t.Fatalf("owner delete: want 204, got %d", status)
	}
	if ev := readType(t, dmWS, "token.removed"); ev["body"].(map[string]any)["token_id"] != heroID {
		t.Fatalf("delete should remove the hero token: %s", fmtBody(ev))
	}
	readType(t, dmWS, "vision.update")

	if status := statusOf(t, player, "GET", sheetPath, nil); status != 404 {
		t.Fatalf("deleted sheet still readable: %d", status)
	}
	if tokens, _ := get[map[string]any](t, dm, a.server.URL, roomPath+"/state")["visibleTokens"].([]any); len(tokens) != 0 {
		t.Fatalf("the deleted character's token stayed on the map: %+v", tokens)
	}
	members := get[[]map[string]any](t, dm, a.server.URL, roomPath+"/members")
	for _, member := range members {
		if member["user_id"] == playerUser["id"] && member["sheet_id"] != nil {
			t.Fatalf("the player should stay in the room without a character: %+v", member)
		}
	}
	if len(members) != 2 {
		t.Fatalf("deleting a character should not remove room members: %+v", members)
	}
	if status := statusOf(t, player, "DELETE", sheetPath, nil); status != 404 {
		t.Fatalf("second delete: want 404, got %d", status)
	}
}

func TestDefaultRuleBookAncestryBonusAndClassSpells(t *testing.T) {
	a := newTestApp(t)
	client, _ := login(t, a, "default-bonus@example.com")
	const defaultID = "00000000-0000-4000-8000-000000000005"
	scores := map[string]any{"strength": 15, "dexterity": 14, "constitution": 13, "intelligence": 12, "wisdom": 10, "charisma": 8}
	body := func(bonuses map[string]any) map[string]any {
		return map[string]any{"rule_book_id": defaultID, "name": "Bonus", "creation": map[string]any{
			"class_id": "fighter", "scores": scores, "bonuses": bonuses,
			"choices": map[string]any{"skill_proficiencies": []string{"athletics", "perception"}},
		}}
	}
	sheet := post[map[string]any](t, client, a.server.URL, "/api/sheets", body(map[string]any{"strength": 2, "constitution": 1}))
	if data := sheet["data"].(map[string]any); data["strength"] != float64(17) || data["constitution"] != float64(14) || data["dexterity"] != float64(14) {
		t.Fatalf("the +2/+1 ancestry bonus was not applied: %+v", data)
	}
	for _, bonuses := range []map[string]any{{"strength": 3}, {"strength": 2, "dexterity": 2}} {
		if status, code := errorOf(t, client, "POST", a.server.URL+"/api/sheets", body(bonuses)); status != 400 || code != "invalid_creation" {
			t.Fatalf("bonuses %v: want 400 invalid_creation, got %d %s", bonuses, status, code)
		}
	}

	book := get[map[string]any](t, client, a.server.URL, "/api/rule-books/"+defaultID)
	spells := map[string][]any{}
	for _, entry := range book["creation_rules"].(map[string]any)["classes"].([]any) {
		class := entry.(map[string]any)
		list, ok := class["spell_list"].([]any)
		if !ok {
			t.Fatalf("%s has no spell list", class["id"])
		}
		spells[class["id"].(string)] = list
	}
	if len(spells["fighter"]) != 0 || len(spells["wizard"]) != 10 || len(spells["paladin"]) != 1 || spells["warlock"][1] != "eldritch_blast" {
		t.Fatalf("unexpected class spell lists: %+v", spells)
	}
}
