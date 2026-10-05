package game

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// MaxCompendiumEntries caps each of a rule book's compendium lists.
const MaxCompendiumEntries = 300

// Compendium is a rule book's catalogue of weapons, spells and abilities, and items that
// characters can pick, in the shapes a sheet stores them.
type Compendium struct {
	Attacks []Attack `json:"attacks"`
	Actions []Action `json:"actions"`
	Items   []Item   `json:"items"`
}

// ParseCompendium validates and normalizes a rule book's compendium; empty or null input is
// an empty compendium.
func ParseCompendium(raw []byte) (Compendium, error) {
	c := Compendium{Attacks: []Attack{}, Actions: []Action{}, Items: []Item{}}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return c, nil
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	var lists struct {
		Attacks json.RawMessage `json:"attacks"`
		Actions json.RawMessage `json:"actions"`
		Items   json.RawMessage `json:"items"`
	}
	if err := dec.Decode(&lists); err != nil {
		return Compendium{}, fmt.Errorf("compendium must be an object with attacks, actions and items lists")
	}
	var err error
	if c.Attacks, err = decodeAttacks(lists.Attacks); err != nil {
		return Compendium{}, fmt.Errorf("compendium: %w", err)
	}
	if len(c.Attacks) > MaxCompendiumEntries {
		return Compendium{}, fmt.Errorf("compendium can have at most %d weapons", MaxCompendiumEntries)
	}
	if c.Actions, err = decodeActions(lists.Actions); err != nil {
		return Compendium{}, fmt.Errorf("compendium: %w", err)
	}
	if len(c.Actions) > MaxCompendiumEntries {
		return Compendium{}, fmt.Errorf("compendium can have at most %d spells and abilities", MaxCompendiumEntries)
	}
	if c.Items, err = decodeItems(lists.Items); err != nil {
		return Compendium{}, fmt.Errorf("compendium: %w", err)
	}
	if len(c.Items) > MaxCompendiumEntries {
		return Compendium{}, fmt.Errorf("compendium can have at most %d items", MaxCompendiumEntries)
	}
	return c, nil
}

// Has reports whether the named list ("attacks", "actions" or "items") holds an entry with id.
func (c Compendium) Has(list, id string) bool {
	switch list {
	case "attacks":
		for _, a := range c.Attacks {
			if a.ID == id {
				return true
			}
		}
	case "actions":
		for _, a := range c.Actions {
			if a.ID == id {
				return true
			}
		}
	case "items":
		for _, it := range c.Items {
			if it.ID == id {
				return true
			}
		}
	}
	return false
}
