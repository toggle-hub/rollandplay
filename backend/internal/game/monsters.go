package game

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"
)

// MaxMonsters caps how many monster templates one rule book may define.
const MaxMonsters = 300

var monsterIDRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// Monster is a rule book's stat block template. Placing one copies Stats into the new
// token's attributes, so each placed monster is independent of the book and of the others.
type Monster struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	SizeM       float64        `json:"size_m"`
	Stats       map[string]any `json:"stats"`
}

// ParseMonsters validates and normalizes a rule book's monsters list. Stats are free-form
// like character data, but stats.attacks, stats.actions and stats.items must be valid so placed
// monsters can fight.
func ParseMonsters(raw []byte) ([]Monster, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []Monster{}, nil
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	var monsters []Monster
	if err := dec.Decode(&monsters); err != nil {
		return nil, fmt.Errorf("monsters must be a list of {id, name, description, size_m, stats} objects")
	}
	if monsters == nil {
		monsters = []Monster{}
	}
	if len(monsters) > MaxMonsters {
		return nil, fmt.Errorf("a rule book can have at most %d monsters", MaxMonsters)
	}
	seen := make(map[string]struct{}, len(monsters))
	for i := range monsters {
		m := &monsters[i]
		m.ID = strings.TrimSpace(m.ID)
		m.Name = strings.TrimSpace(m.Name)
		m.Description = strings.TrimSpace(m.Description)
		if _, dup := seen[m.ID]; !monsterIDRE.MatchString(m.ID) || dup {
			return nil, fmt.Errorf("monster %d needs a unique id of lowercase letters, digits, - or _", i+1)
		}
		seen[m.ID] = struct{}{}
		if m.Name == "" || utf8.RuneCountInString(m.Name) > 80 {
			return nil, fmt.Errorf("monster %d needs a name of at most 80 characters", i+1)
		}
		if utf8.RuneCountInString(m.Description) > 1000 {
			return nil, fmt.Errorf("monster %q description must be at most 1000 characters", m.Name)
		}
		if math.IsNaN(m.SizeM) || !(m.SizeM > 0 && m.SizeM <= 30) {
			return nil, fmt.Errorf("monster %q size must be between 0 and 30 meters", m.Name)
		}
		if m.Stats == nil {
			m.Stats = map[string]any{}
		}
		if attacks, ok := m.Stats["attacks"]; ok {
			b, _ := json.Marshal(attacks)
			if _, err := ParseAttacks(b); err != nil {
				return nil, fmt.Errorf("monster %q: %w", m.Name, err)
			}
		}
		if actions, ok := m.Stats["actions"]; ok {
			b, _ := json.Marshal(actions)
			if _, err := ParseActions(b); err != nil {
				return nil, fmt.Errorf("monster %q: %w", m.Name, err)
			}
		}
		if items, ok := m.Stats["items"]; ok {
			b, _ := json.Marshal(items)
			if _, err := ParseItems(b); err != nil {
				return nil, fmt.Errorf("monster %q: %w", m.Name, err)
			}
		}
	}
	return monsters, nil
}

// FindMonster returns the monster with the given id.
func FindMonster(monsters []Monster, id string) (Monster, bool) {
	for _, m := range monsters {
		if m.ID == id {
			return m, true
		}
	}
	return Monster{}, false
}

// NextTokenName numbers repeated monsters: "Goblin", then "Goblin 2", "Goblin 3", ...
func NextTokenName(base string, taken []string) string {
	used := make(map[string]bool, len(taken))
	for _, name := range taken {
		used[name] = true
	}
	if !used[base] {
		return base
	}
	for n := 2; ; n++ {
		if name := fmt.Sprintf("%s %d", base, n); !used[name] {
			return name
		}
	}
}
