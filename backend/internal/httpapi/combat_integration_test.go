package httpapi_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// combatTable is a room on the built-in D&D book with a player's hero (initiative +50, so always
// first) and two goblins, the second hidden from players. Both sockets have read their snapshot.
type combatTable struct {
	a                          *testApp
	roomID                     string
	dm, player                 *http.Client
	dmWS, pWS                  *websocket.Conn
	heroID, goblinID, hiddenID string
	heroSheetID                string
}

func newCombatTable(t *testing.T, prefix string) *combatTable {
	t.Helper()
	a := newTestApp(t)
	const dndID = "00000000-0000-4000-8000-000000000005"
	dm, _ := login(t, a, prefix+"-dm@example.com")
	player, _ := login(t, a, prefix+"-player@example.com")
	creation := map[string]any{"class_id": "fighter", "scores": map[string]any{"strength": 15, "dexterity": 14, "constitution": 13, "intelligence": 12, "wisdom": 10, "charisma": 8}, "choices": map[string]any{"skill_proficiencies": []string{"athletics", "perception"}}}
	sheet := post[map[string]any](t, player, a.server.URL, "/api/sheets", map[string]any{"rule_book_id": dndID, "name": "Hero", "creation": creation})
	patch[map[string]any](t, player, a.server.URL, "/api/sheets/"+sheet["id"].(string), map[string]any{"data": map[string]any{"initiative": 50, "dexterity": 16, "strength": 14}})
	room := post[map[string]any](t, dm, a.server.URL, "/api/rooms", map[string]any{"name": "Ambush", "rule_book_id": dndID})
	roomID := room["id"].(string)
	roomPath := "/api/rooms/" + roomID
	post[map[string]any](t, player, a.server.URL, "/api/rooms/join", map[string]any{"invite_code": room["invite_code"], "sheet_id": sheet["id"]})
	m := post[map[string]any](t, dm, a.server.URL, "/api/maps", map[string]any{"name": "Road", "width_m": 20, "height_m": 20})
	post[map[string]any](t, dm, a.server.URL, roomPath+"/maps", map[string]any{"map_id": m["id"], "is_active": true})
	hero := post[map[string]any](t, player, a.server.URL, roomPath+"/tokens", map[string]any{"sheet_id": sheet["id"], "name": "Hero", "x_m": 1, "y_m": 1})
	goblin := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"monster_id": "goblin", "x_m": 3, "y_m": 1})
	hidden := post[map[string]any](t, dm, a.server.URL, roomPath+"/tokens", map[string]any{"monster_id": "goblin", "x_m": 5, "y_m": 1, "is_hidden": true})
	tbl := &combatTable{a: a, roomID: roomID, dm: dm, player: player, dmWS: dialWS(t, a, dm, roomID), pWS: dialWS(t, a, player, roomID),
		heroID: hero["id"].(string), goblinID: goblin["id"].(string), hiddenID: hidden["id"].(string), heroSheetID: sheet["id"].(string)}
	t.Cleanup(func() { tbl.dmWS.Close(); tbl.pWS.Close() })
	readType(t, tbl.dmWS, "state.snapshot")
	readType(t, tbl.pWS, "state.snapshot")
	return tbl
}

func (tbl *combatTable) state(t *testing.T, c *http.Client) map[string]any {
	t.Helper()
	return get[map[string]any](t, c, tbl.a.server.URL, "/api/rooms/"+tbl.roomID+"/state")
}

// combat returns the viewer's fight and its combatants' token IDs in turn order.
func (tbl *combatTable) combat(t *testing.T, c *http.Client) (map[string]any, []string) {
	t.Helper()
	combat, _ := tbl.state(t, c)["combat"].(map[string]any)
	if combat == nil {
		return nil, nil
	}
	var tokens []string
	for _, cb := range combat["combatants"].([]any) {
		tokens = append(tokens, cb.(map[string]any)["token_id"].(string))
	}
	return combat, tokens
}

// currentToken is the token whose turn it is, as the game master sees it.
func (tbl *combatTable) currentToken(t *testing.T) (string, string) {
	t.Helper()
	combat, _ := tbl.combat(t, tbl.dm)
	for _, cb := range combat["combatants"].([]any) {
		if cb := cb.(map[string]any); cb["id"] == combat["current_combatant_id"] {
			return cb["id"].(string), cb["token_id"].(string)
		}
	}
	t.Fatalf("no current combatant in %+v", combat)
	return "", ""
}

func (tbl *combatTable) combatantID(t *testing.T, tokenID string) string {
	t.Helper()
	combat, _ := tbl.combat(t, tbl.dm)
	for _, cb := range combat["combatants"].([]any) {
		if cb := cb.(map[string]any); cb["token_id"] == tokenID {
			return cb["id"].(string)
		}
	}
	t.Fatalf("token %s is not in the fight", tokenID)
	return ""
}

// send sends a combat message and waits until both sockets saw the change; it returns the chat
// announcement the player received, or "" when there was none.
func (tbl *combatTable) send(t *testing.T, conn *websocket.Conn, typ, id string, body map[string]any, announced bool) string {
	t.Helper()
	sendWS(t, conn, typ, id, body)
	line := ""
	for _, c := range []*websocket.Conn{tbl.dmWS, tbl.pWS} {
		if announced {
			ev := readType(t, c, "chat.message")
			if ev["requestId"] != id {
				t.Fatalf("%s: unexpected chat %s", id, fmtBody(ev))
			}
			line = ev["body"].(map[string]any)["body"].(string)
		}
		if ev := readType(t, c, "combat.changed"); ev["requestId"] != id {
			t.Fatalf("%s: unexpected change %s", id, fmtBody(ev))
		}
	}
	return line
}

func (tbl *combatTable) fail(t *testing.T, conn *websocket.Conn, typ, id, code string, body map[string]any) {
	t.Helper()
	sendWS(t, conn, typ, id, body)
	if ev := readType(t, conn, "error"); ev["requestId"] != id || ev["body"].(map[string]any)["code"] != code {
		t.Fatalf("%s: want %s, got %s", id, code, fmtBody(ev))
	}
}

func TestRoomCombatTurnOrder(t *testing.T) {
	tbl := newCombatTable(t, "combat")
	everyone := []string{tbl.heroID, tbl.goblinID, tbl.hiddenID}
	tbl.fail(t, tbl.pWS, "combat.start", "player-start", "forbidden", map[string]any{"tokenIds": everyone})
	tbl.fail(t, tbl.dmWS, "combat.start", "no-tokens", "invalid_combat", map[string]any{"tokenIds": []string{}})
	tbl.fail(t, tbl.dmWS, "combat.start", "stranger", "invalid_target", map[string]any{"tokenIds": []string{tbl.heroID, "00000000-0000-4000-8000-000000000001"}})
	tbl.fail(t, tbl.pWS, "combat.next", "nothing-running", "no_combat", map[string]any{"combatantId": "x"})

	line := tbl.send(t, tbl.dmWS, "combat.start", "start", map[string]any{"tokenIds": everyone}, true)
	if !strings.HasPrefix(line, "Combat begins! Initiative: Hero ") || !strings.HasSuffix(line, "Round 1: Hero's turn.") || strings.Count(line, "Goblin") != 1 {
		t.Fatalf("start announcement: %q", line)
	}
	dmCombat, dmOrder := tbl.combat(t, tbl.dm)
	pCombat, pOrder := tbl.combat(t, tbl.player)
	if dmCombat["round"] != float64(1) || len(dmOrder) != 3 || dmOrder[0] != tbl.heroID {
		t.Fatalf("game master's turn order: %+v", dmCombat)
	}
	if len(pOrder) != 2 || pOrder[0] != tbl.heroID || pOrder[1] != tbl.goblinID || pCombat["current_combatant_id"] != dmCombat["current_combatant_id"] {
		t.Fatalf("players must not see the hidden goblin: %+v", pCombat)
	}
	hero := dmCombat["combatants"].([]any)[0].(map[string]any)
	if hero["initiative"].(float64) < 51 || hero["player_user_id"] == "" || hero["name"] != "Hero" {
		t.Fatalf("hero combatant: %+v", hero)
	}
	tbl.fail(t, tbl.dmWS, "combat.start", "again", "combat_running", map[string]any{"tokenIds": everyone})

	// The player ends their own turn, once; they cannot end a goblin's.
	heroCombatant := hero["id"].(string)
	tbl.fail(t, tbl.pWS, "combat.next", "not-current", "stale_turn", map[string]any{"combatantId": tbl.combatantID(t, tbl.goblinID)})
	// A hidden goblin's turn is never named in chat.
	tbl.send(t, tbl.pWS, "combat.next", "hero-done", map[string]any{"combatantId": heroCombatant}, dmOrder[1] == tbl.goblinID)
	tbl.fail(t, tbl.pWS, "combat.next", "hero-twice", "stale_turn", map[string]any{"combatantId": heroCombatant})
	second, secondToken := tbl.currentToken(t)
	if secondToken != dmOrder[1] {
		t.Fatalf("the turn should pass to %s, not %s", dmOrder[1], secondToken)
	}
	tbl.fail(t, tbl.pWS, "combat.next", "goblin-turn", "forbidden", map[string]any{"combatantId": second})
	if pCombat, _ := tbl.combat(t, tbl.player); secondToken == tbl.hiddenID && pCombat["current_combatant_id"] != nil {
		t.Fatalf("players must not learn that a hidden token acts: %+v", pCombat)
	}

	// The game master runs the goblins' turns; the order wraps into round 2.
	tbl.send(t, tbl.dmWS, "combat.next", "second-done", map[string]any{"combatantId": second}, dmOrder[2] == tbl.goblinID)
	third, _ := tbl.currentToken(t)
	line = tbl.send(t, tbl.dmWS, "combat.next", "third-done", map[string]any{"combatantId": third}, true)
	if line != "Round 2: Hero's turn." {
		t.Fatalf("wrap announcement: %q", line)
	}
	if combat, _ := tbl.combat(t, tbl.dm); combat["round"] != float64(2) || combat["current_combatant_id"] != heroCombatant {
		t.Fatalf("round 2 should start with the hero: %+v", combat)
	}

	// Reordering keeps the turn with the hero; removing the hero, last in order, starts round 3.
	tbl.fail(t, tbl.pWS, "combat.move", "player-move", "forbidden", map[string]any{"combatantId": heroCombatant, "toIndex": 2})
	tbl.fail(t, tbl.dmWS, "combat.move", "far", "invalid_combat", map[string]any{"combatantId": heroCombatant, "toIndex": 3})
	tbl.send(t, tbl.dmWS, "combat.move", "hero-last", map[string]any{"combatantId": heroCombatant, "toIndex": 2}, false)
	if combat, order := tbl.combat(t, tbl.dm); order[2] != tbl.heroID || combat["current_combatant_id"] != heroCombatant {
		t.Fatalf("moving the hero should keep the turn: %+v", combat)
	}
	tbl.send(t, tbl.dmWS, "combat.remove", "hero-out", map[string]any{"combatantId": heroCombatant}, true)
	combat, order := tbl.combat(t, tbl.dm)
	if combat["round"] != float64(3) || len(order) != 2 || combat["current_combatant_id"] != combat["combatants"].([]any)[0].(map[string]any)["id"] {
		t.Fatalf("removing the last combatant on their turn should start round 3: %+v", combat)
	}

	// The hero rejoins at the top without taking the turn from whoever has it.
	current := combat["current_combatant_id"]
	line = tbl.send(t, tbl.dmWS, "combat.add", "hero-back", map[string]any{"tokenIds": []string{tbl.heroID}}, true)
	if !strings.HasPrefix(line, "Hero (") || !strings.HasSuffix(line, ") joins the fight.") {
		t.Fatalf("join announcement: %q", line)
	}
	if combat, order := tbl.combat(t, tbl.dm); order[0] != tbl.heroID || len(order) != 3 || combat["current_combatant_id"] != current {
		t.Fatalf("a joiner slots in by initiative: %+v", combat)
	}
	tbl.fail(t, tbl.dmWS, "combat.add", "hero-twice", "invalid_combat", map[string]any{"tokenIds": []string{tbl.heroID}})

	// The fight survives reloads; a deleted token leaves it.
	sendWS(t, tbl.dmWS, "token.remove", "goblin-gone", map[string]any{"tokenId": tbl.goblinID})
	readType(t, tbl.dmWS, "token.removed")
	readType(t, tbl.pWS, "token.removed")
	if _, order := tbl.combat(t, tbl.dm); len(order) != 2 {
		t.Fatalf("a removed token should leave the fight: %v", order)
	}

	if line := tbl.send(t, tbl.dmWS, "combat.end", "end", map[string]any{}, true); line != "Combat ends after 3 rounds." {
		t.Fatalf("end announcement: %q", line)
	}
	if combat, _ := tbl.combat(t, tbl.player); combat != nil {
		t.Fatalf("combat should be over: %+v", combat)
	}
	tbl.fail(t, tbl.dmWS, "combat.end", "end-again", "no_combat", map[string]any{})
}

func TestRoomRollsWithAdvantage(t *testing.T) {
	tbl := newCombatTable(t, "advantage")
	roll := func(conn *websocket.Conn, typ, id string, body map[string]any) map[string]any {
		t.Helper()
		sendWS(t, conn, typ, id, body)
		var out map[string]any
		for _, c := range []*websocket.Conn{tbl.dmWS, tbl.pWS} {
			ev := readType(t, c, "roll.result")
			if ev["requestId"] != id {
				t.Fatalf("%s: unexpected roll %s", id, fmtBody(ev))
			}
			out = ev["body"].(map[string]any)
		}
		return out
	}
	// kept checks a roll of two d20s that counts exactly one: the higher (kh) or the lower (kl).
	kept := func(r map[string]any) {
		t.Helper()
		die := r["dice"].([]any)[0].(map[string]any)
		values, marks := die["values"].([]any), die["kept"].([]any)
		if len(values) != 2 || len(marks) != 2 || marks[0] == marks[1] {
			t.Fatalf("two dice, one kept: %+v", die)
		}
		keptValue, droppedValue := values[0].(float64), values[1].(float64)
		if marks[1] == true {
			keptValue, droppedValue = droppedValue, keptValue
		}
		if die["keep"] == "kh" && keptValue < droppedValue || die["keep"] == "kl" && keptValue > droppedValue {
			t.Fatalf("wrong die kept by %v: %+v", die["keep"], die)
		}
		if total, mod := r["total"].(float64), r["modifier"].(float64); total != keptValue+mod {
			t.Fatalf("total %v should be the kept %v plus %v", total, keptValue, mod)
		}
	}

	msg := roll(tbl.pWS, "check.quick", "stealth-adv", map[string]any{"tokenId": tbl.heroID, "kind": "skill", "key": "stealth", "mode": "advantage", "bonus": 2})
	r := msg["roll"].(map[string]any)
	// Dexterity 16 (+3) with no stealth proficiency, plus the one-off +2.
	if msg["body"] != "Hero: Stealth check (advantage, +2 bonus)" || r["expression"] != "2d20kh1+5" {
		t.Fatalf("quick check with advantage: %+v", msg)
	}
	kept(r)

	tbl.fail(t, tbl.pWS, "check.quick", "bad-mode", "invalid_roll", map[string]any{"tokenId": tbl.heroID, "kind": "skill", "key": "stealth", "mode": "lucky"})
	tbl.fail(t, tbl.pWS, "check.quick", "big-bonus", "invalid_roll", map[string]any{"tokenId": tbl.heroID, "kind": "skill", "key": "stealth", "bonus": 21})

	// The player's character attacks a goblin with advantage; a save-based spell takes no advantage.
	actions := "/api/rooms/" + tbl.roomID + "/tokens/" + tbl.heroID + "/actions"
	patch[map[string]any](t, tbl.player, tbl.a.server.URL, actions, map[string]any{
		"attacks": []map[string]any{{"id": "sword", "name": "Sword", "range_m": 3, "ability": "strength", "proficient": false, "attack_bonus": 0, "damage": "1d8", "damage_bonus": 0}},
		"actions": []map[string]any{{"id": "burst", "name": "Burst", "kind": "save", "range_m": 20, "area_radius_m": 1, "save_ability": "dexterity", "dice": "1d6"}},
		"items":   []any{},
	})
	tbl.fail(t, tbl.pWS, "action.resolve", "save-adv", "invalid_roll", map[string]any{"sourceTokenId": tbl.heroID, "source": "action", "actionId": "burst", "point": map[string]float64{"x": 3, "y": 1}, "mode": "advantage"})
	msg = roll(tbl.pWS, "action.resolve", "sword-adv", map[string]any{"sourceTokenId": tbl.heroID, "source": "attack", "actionId": "sword", "targetTokenId": tbl.goblinID, "mode": "advantage"})
	target := msg["roll"].(map[string]any)["action"].(map[string]any)["targets"].([]any)[0].(map[string]any)
	if msg["body"] != "Hero attacks Goblin with Sword (advantage)" || target["roll"].(map[string]any)["expression"] != "2d20kh1+2" {
		t.Fatalf("attack with advantage: %+v", msg)
	}
	kept(target["roll"].(map[string]any))

	// A prompted check rolled with disadvantage keeps the lower die.
	playerID := tbl.state(t, tbl.player)["ownTokens"].([]any)[0].(map[string]any)["owner_user_id"].(string)
	sendWS(t, tbl.dmWS, "check.prompt", "prompt", map[string]any{"kind": "ability", "key": "dexterity", "dc": 10, "targetUserIds": []string{playerID}})
	readType(t, tbl.pWS, "check.changed")
	checkID := tbl.state(t, tbl.player)["checks"].([]any)[0].(map[string]any)["id"].(string)
	msg = roll(tbl.pWS, "check.roll", "dex-dis", map[string]any{"checkId": checkID, "mode": "disadvantage"})
	r = msg["roll"].(map[string]any)
	if !strings.HasPrefix(msg["body"].(string), "Hero: Dexterity check (DC 10, disadvantage), ") || r["expression"] != "2d20kl1+3" {
		t.Fatalf("prompted check with disadvantage: %+v", msg)
	}
	kept(r)
	if r["check"].(map[string]any)["success"] != (r["total"].(float64) >= 10) {
		t.Fatalf("check outcome uses the kept die: %+v", r)
	}
}
