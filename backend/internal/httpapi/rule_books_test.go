package httpapi_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestRuleBookDeleteOwnerOnlyAndRefusedWhileUsed(t *testing.T) {
	a := newTestApp(t)
	owner, _ := login(t, a, "book-owner@example.com")
	player, _ := login(t, a, "book-player@example.com")
	const builtInID = "00000000-0000-4000-8000-000000000005"
	base := a.server.URL + "/api/rule-books/"

	unused := post[map[string]any](t, owner, a.server.URL, "/api/rule-books", map[string]any{"name": "Scratch", "attributes": map[string]any{}})
	if status := statusOf(t, owner, "DELETE", base+unused["id"].(string), nil); status != 204 {
		t.Fatalf("deleting an unused book: status %d", status)
	}
	if status := statusOf(t, owner, "GET", base+unused["id"].(string), nil); status != 404 {
		t.Fatalf("a deleted book should be gone: status %d", status)
	}

	if status, code := errorOf(t, owner, "DELETE", base+builtInID, nil); status != 403 || code != "forbidden" {
		t.Fatalf("deleting the built-in book: %d %s", status, code)
	}
	private := post[map[string]any](t, owner, a.server.URL, "/api/rule-books", map[string]any{"name": "Secret", "attributes": map[string]any{}})
	if status := statusOf(t, player, "DELETE", base+private["id"].(string), nil); status != 404 {
		t.Fatalf("deleting someone else's private book: status %d", status)
	}
	if status := statusOf(t, owner, "DELETE", base+"not-a-uuid", nil); status != 404 {
		t.Fatalf("deleting a malformed id: status %d", status)
	}

	// Another player's character and the owner's room both keep the shared book in use.
	shared := post[map[string]any](t, owner, a.server.URL, "/api/rule-books", map[string]any{"name": "Shared", "attributes": map[string]any{}, "is_public": true})
	sharedPath := base + shared["id"].(string)
	post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": shared["id"], "name": "Hero", "data": map[string]any{}})
	post[map[string]any](t, owner, a.server.URL, "/api/rooms", map[string]any{"name": "Table", "rule_book_id": shared["id"]})
	if status := statusOf(t, player, "DELETE", sharedPath, nil); status != 403 {
		t.Fatalf("only the owner may delete a readable book: status %d", status)
	}
	req, _ := http.NewRequest("DELETE", sharedPath, nil)
	res, err := owner.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	_ = json.NewDecoder(res.Body).Decode(&body)
	if res.StatusCode != 409 || body.Error.Code != "rule_book_in_use" || !strings.Contains(body.Error.Message, "1 room and 1 character") {
		t.Fatalf("deleting a used book: status %d %+v", res.StatusCode, body.Error)
	}
	if got := get[map[string]any](t, owner, a.server.URL, "/api/rule-books/"+shared["id"].(string)); got["id"] != shared["id"] {
		t.Fatalf("a used book should survive a refused delete: %+v", got)
	}
}
