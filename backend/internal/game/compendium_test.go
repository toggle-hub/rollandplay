package game

import (
	"fmt"
	"strings"
	"testing"
)

func TestParseCompendiumEmpty(t *testing.T) {
	c, err := ParseCompendium(nil)
	if err != nil {
		t.Fatal(err)
	}
	if c.Attacks == nil || c.Actions == nil || c.Items == nil || len(c.Attacks)+len(c.Actions)+len(c.Items) != 0 {
		t.Fatalf("missing compendium should be empty, non-nil lists: %+v", c)
	}
	if _, err := ParseCompendium([]byte(`{"spells":[]}`)); err == nil {
		t.Fatal("unknown compendium key accepted")
	}
}

func TestParseCompendiumHoldsMoreThanACharacter(t *testing.T) {
	entries := make([]string, 25)
	for i := range entries {
		entries[i] = fmt.Sprintf(`{"id":"w%d","name":"Weapon %d","range_m":1.5,"damage":"1d6"}`, i, i)
	}
	list := "[" + strings.Join(entries, ",") + "]"
	c, err := ParseCompendium([]byte(`{"attacks":` + list + `}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Attacks) != 25 || !c.Has("attacks", "w24") || c.Has("actions", "w24") || c.Has("spells", "w0") {
		t.Fatalf("unexpected compendium: %+v", c)
	}
	if _, err := ParseAttacks([]byte(list)); err == nil {
		t.Fatal("a character accepted 25 attacks")
	}
}

func TestParseCompendiumWrapsEntryErrors(t *testing.T) {
	_, err := ParseCompendium([]byte(`{"attacks":[{"id":"x","name":"X","range_m":1,"damage":"banana"}]}`))
	if err == nil || !strings.HasPrefix(err.Error(), "compendium: attack") {
		t.Fatalf("expected a compendium attack error, got %v", err)
	}
}

func TestValidateStatLists(t *testing.T) {
	bad := map[string]any{"attacks": []any{map[string]any{"id": "x", "name": "X", "range_m": 1, "damage": "banana"}}}
	if err := ValidateStatLists(bad); err == nil {
		t.Fatal("bad attack damage accepted")
	}
	if err := ValidateStatLists(map[string]any{}); err != nil {
		t.Fatal(err)
	}
}
