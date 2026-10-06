package httpapi_test

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"testing"
)

func uploadMapBackground(t *testing.T, a *testApp, c *http.Client) string {
	t.Helper()
	png, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, _ := form.CreatePart(textproto.MIMEHeader{"Content-Disposition": {`form-data; name="file"; filename="cave.png"`}, "Content-Type": {"image/png"}})
	_, _ = part.Write(png)
	_ = form.WriteField("kind", "map_background")
	_ = form.Close()
	req, _ := http.NewRequest("POST", a.server.URL+"/api/assets", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var asset map[string]any
	_ = json.NewDecoder(res.Body).Decode(&asset)
	if res.StatusCode != 201 {
		t.Fatalf("upload: status %d %+v", res.StatusCode, asset)
	}
	return asset["id"].(string)
}

func TestMapBackgroundCanBeCleared(t *testing.T) {
	a := newTestApp(t)
	owner, _ := login(t, a, "map-background@example.com")
	m := post[map[string]any](t, owner, a.server.URL, "/api/maps", map[string]any{"name": "Cave"})
	mapPath := "/api/maps/" + m["id"].(string)
	assetID := uploadMapBackground(t, a, owner)

	if got := patch[map[string]any](t, owner, a.server.URL, mapPath, map[string]any{"background_asset_id": assetID}); got["background_asset_id"] != assetID {
		t.Fatalf("background should attach: %+v", got)
	}
	if got := patch[map[string]any](t, owner, a.server.URL, mapPath, map[string]any{"name": "Deep cave"}); got["background_asset_id"] != assetID {
		t.Fatalf("a patch without background_asset_id should keep the background: %+v", got)
	}
	if got := patch[map[string]any](t, owner, a.server.URL, mapPath, map[string]any{"background_asset_id": nil}); got["background_asset_id"] != nil {
		t.Fatalf("background_asset_id null should remove the background: %+v", got)
	}
	if got := get[map[string]any](t, owner, a.server.URL, mapPath); got["background_asset_id"] != nil || got["name"] != "Deep cave" {
		t.Fatalf("cleared background should stay cleared: %+v", got)
	}
}

func TestMapStructuresKeepClientIDs(t *testing.T) {
	a := newTestApp(t)
	owner, _ := login(t, a, "map-client-ids@example.com")
	m := post[map[string]any](t, owner, a.server.URL, "/api/maps", map[string]any{"name": "Fort"})
	structuresURL := a.server.URL + "/api/maps/" + m["id"].(string) + "/structures"
	const id = "0b6f3f8e-5c1d-4a52-9d3e-2f7a8b9c1d2e"
	wall := map[string]any{"id": id, "kind": "wall", "geometry": []map[string]float64{{"x": 0, "y": 0}, {"x": 3, "y": 0}}}

	created := post[map[string]any](t, owner, a.server.URL, "/api/maps/"+m["id"].(string)+"/structures", wall)
	if created["id"] != id {
		t.Fatalf("the client's id should be kept: %+v", created)
	}
	if status, code := errorOf(t, owner, "POST", structuresURL, wall); status != 409 || code != "structure_exists" {
		t.Fatalf("reusing an id: status %d code %q", status, code)
	}
	if status, code := errorOf(t, owner, "POST", structuresURL, map[string]any{"id": "nope", "kind": "wall", "geometry": wall["geometry"]}); status != 400 || code != "invalid_id" {
		t.Fatalf("an invalid id: status %d code %q", status, code)
	}
	// Deleting and recreating with the same id is how the editor undoes a delete.
	if status := statusOf(t, owner, "DELETE", structuresURL+"/"+id, nil); status != 204 {
		t.Fatalf("delete: status %d", status)
	}
	if again := post[map[string]any](t, owner, a.server.URL, "/api/maps/"+m["id"].(string)+"/structures", wall); again["id"] != id {
		t.Fatalf("a deleted id should be reusable: %+v", again)
	}

	listed := get[[]map[string]any](t, owner, a.server.URL, "/api/maps")
	if len(listed) != 1 {
		t.Fatalf("one map expected: %+v", listed)
	}
	preview, _ := listed[0]["preview_structures"].([]any)
	if len(preview) != 1 || preview[0].(map[string]any)["kind"] != "wall" || len(preview[0].(map[string]any)["geometry"].([]any)) != 2 {
		t.Fatalf("the map list should carry structure outlines for thumbnails: %+v", listed[0]["preview_structures"])
	}
}

func TestMapRoomsListsTablesYouRun(t *testing.T) {
	a := newTestApp(t)
	gm, _ := login(t, a, "map-rooms-gm@example.com")
	player, _ := login(t, a, "map-rooms-player@example.com")
	ownMap := post[map[string]any](t, gm, a.server.URL, "/api/maps", map[string]any{"name": "Crypt"})
	otherMap := post[map[string]any](t, gm, a.server.URL, "/api/maps", map[string]any{"name": "Tavern"})
	running := post[map[string]any](t, gm, a.server.URL, "/api/rooms", map[string]any{"name": "Running table"})
	idle := post[map[string]any](t, gm, a.server.URL, "/api/rooms", map[string]any{"name": "Idle table"})
	playing := post[map[string]any](t, player, a.server.URL, "/api/rooms", map[string]any{"name": "Someone else's table"})
	post[map[string]any](t, gm, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": playing["invite_code"]})
	post[map[string]any](t, gm, a.server.URL, "/api/rooms/"+running["id"].(string)+"/maps", map[string]any{"map_id": otherMap["id"], "is_active": true})

	roomsPath := "/api/maps/" + ownMap["id"].(string) + "/rooms"
	rooms := get[[]map[string]any](t, gm, a.server.URL, roomsPath)
	if len(rooms) != 2 {
		t.Fatalf("only rooms the caller runs should be listed: %+v", rooms)
	}
	byID := map[string]map[string]any{}
	for _, room := range rooms {
		byID[room["id"].(string)] = room
	}
	if got := byID[running["id"].(string)]; got["is_active"] != false || got["active_map_name"] != "Tavern" {
		t.Fatalf("running room should show its current map: %+v", got)
	}
	if got := byID[idle["id"].(string)]; got["is_active"] != false || got["active_map_name"] != nil {
		t.Fatalf("idle room has no map: %+v", got)
	}

	post[map[string]any](t, gm, a.server.URL, "/api/rooms/"+idle["id"].(string)+"/maps", map[string]any{"map_id": ownMap["id"], "is_active": true})
	for _, room := range get[[]map[string]any](t, gm, a.server.URL, roomsPath) {
		if room["id"] == idle["id"] && room["is_active"] != true {
			t.Fatalf("the map should be active in the idle room now: %+v", room)
		}
	}
	if status := statusOf(t, player, "GET", a.server.URL+roomsPath, nil); status != 404 {
		t.Fatalf("someone who can't see a private map gets not found: status %d", status)
	}
}
