package game

import (
	"strings"
	"testing"
)

func TestParseMonstersNormalizes(t *testing.T) {
	monsters, err := ParseMonsters([]byte(`[{"id":"goblin","name":"  Goblin ","description":" Nimble ","size_m":1.5,"stats":{"armor_class":15,"attacks":[{"id":"scimitar","name":"Scimitar","range_m":1.5,"ability":"dexterity","proficient":true,"damage":"1d6"}]}},{"id":"blob","name":"Blob","size_m":3}]`))
	if err != nil {
		t.Fatal(err)
	}
	if len(monsters) != 2 || monsters[0].Name != "Goblin" || monsters[0].Description != "Nimble" || monsters[1].Stats == nil {
		t.Fatalf("unexpected monsters: %+v", monsters)
	}
	if m, ok := FindMonster(monsters, "blob"); !ok || m.SizeM != 3 {
		t.Fatalf("blob not found: %+v", m)
	}
	if _, ok := FindMonster(monsters, "orc"); ok {
		t.Fatal("unknown monster found")
	}
	if empty, err := ParseMonsters(nil); err != nil || len(empty) != 0 {
		t.Fatalf("missing monsters should be an empty list: %v %v", empty, err)
	}
}

func TestParseMonstersRejects(t *testing.T) {
	for name, raw := range map[string]string{
		"not a list":       `{"id":"goblin"}`,
		"unknown field":    `[{"id":"goblin","name":"Goblin","size_m":1.5,"hp":7}]`,
		"bad id":           `[{"id":"Goblin!","name":"Goblin","size_m":1.5}]`,
		"duplicate id":     `[{"id":"goblin","name":"Goblin","size_m":1.5},{"id":"goblin","name":"Other","size_m":1.5}]`,
		"missing name":     `[{"id":"goblin","name":" ","size_m":1.5}]`,
		"zero size":        `[{"id":"goblin","name":"Goblin","size_m":0}]`,
		"huge size":        `[{"id":"goblin","name":"Goblin","size_m":31}]`,
		"bad attacks":      `[{"id":"goblin","name":"Goblin","size_m":1.5,"stats":{"attacks":[{"id":"bite","name":"Bite","range_m":1.5,"damage":"lots"}]}}]`,
		"long describe":    `[{"id":"goblin","name":"Goblin","size_m":1.5,"description":"` + strings.Repeat("x", 1001) + `"}]`,
		"stats not object": `[{"id":"goblin","name":"Goblin","size_m":1.5,"stats":[1]}]`,
	} {
		if _, err := ParseMonsters([]byte(raw)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestNextTokenName(t *testing.T) {
	cases := []struct {
		taken []string
		want  string
	}{
		{nil, "Goblin"},
		{[]string{"Orc"}, "Goblin"},
		{[]string{"Goblin"}, "Goblin 2"},
		{[]string{"Goblin", "Goblin 2", "Goblin 4"}, "Goblin 3"},
	}
	for _, c := range cases {
		if got := NextTokenName("Goblin", c.taken); got != c.want {
			t.Errorf("taken %v: got %q, want %q", c.taken, got, c.want)
		}
	}
}
