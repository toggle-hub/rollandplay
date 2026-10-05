package game

import (
	"cmp"
	"encoding/binary"
	"io"
	"slices"
)

// InitiativeModifier is the sheet's or stat block's `initiative` bonus when it is a non-zero
// number, otherwise the dexterity modifier. The built-in book seeds `initiative` as 0, so
// characters that never filled it in still roll with their dexterity.
func InitiativeModifier(stats map[string]any) int {
	if v := statInt(stats, "initiative"); v != nil && *v != 0 {
		return *v
	}
	return abilityMod(stats, "dexterity")
}

// Initiative is one combatant's place in the turn order.
type Initiative struct {
	TokenID   string
	Roll      RollResult
	Dexterity int    // the first tie-breaker: the higher score goes first
	Tiebreak  uint64 // random; settles ties that dexterity does not
}

// RollInitiative rolls 1d20 plus the initiative modifier, and draws the random tie-breaker.
func RollInitiative(tokenID string, stats map[string]any, rng io.Reader) (Initiative, error) {
	roll, err := RollExpression(withModifier("1d20", InitiativeModifier(stats)), rng)
	if err != nil {
		return Initiative{}, err
	}
	var b [8]byte
	if _, err := io.ReadFull(rng, b[:]); err != nil {
		return Initiative{}, err
	}
	return Initiative{TokenID: tokenID, Roll: roll, Dexterity: DexterityScore(stats), Tiebreak: binary.BigEndian.Uint64(b[:])}, nil
}

// DexterityScore breaks initiative ties; a missing score counts as 0.
func DexterityScore(stats map[string]any) int {
	if v := statInt(stats, "dexterity"); v != nil {
		return *v
	}
	return 0
}

// compareInitiative orders a before b (negative) when a acts first: the higher total, then the
// higher dexterity, then the higher random tie-breaker.
func compareInitiative(a, b Initiative) int {
	return cmp.Or(cmp.Compare(b.Roll.Total, a.Roll.Total), cmp.Compare(b.Dexterity, a.Dexterity), cmp.Compare(b.Tiebreak, a.Tiebreak))
}

// SortInitiative puts combatants in turn order.
func SortInitiative(order []Initiative) {
	slices.SortStableFunc(order, compareInitiative)
}

// InitiativeTotals are the stored initiative and dexterity of a combatant already in the order.
type InitiativeTotals struct {
	Total     int
	Dexterity int
}

// JoinIndex is where a combatant joining a running fight goes: after everyone who beats it or
// ties it, so a late joiner never jumps an equal combatant who was already in the order.
func JoinIndex(order []InitiativeTotals, joining Initiative) int {
	for i, c := range order {
		if joining.Roll.Total > c.Total || joining.Roll.Total == c.Total && joining.Dexterity > c.Dexterity {
			return i
		}
	}
	return len(order)
}

// NextTurn passes the turn from index to the next combatant of count, wrapping to the first and
// starting a new round.
func NextTurn(count, index, round int) (int, int) {
	if count == 0 {
		return 0, round
	}
	if index+1 >= count {
		return 0, round + 1
	}
	return index + 1, round
}

// AfterRemoval is the turn once the combatant at removed leaves an order of count (count counts
// it). Removing someone earlier in the order keeps the current combatant; removing the current
// combatant passes the turn on, as if their turn ended.
func AfterRemoval(count, index, round, removed int) (int, int) {
	switch {
	case removed < index:
		return index - 1, round
	case removed > index:
		return index, round
	case index >= count-1 && count > 1:
		return 0, round + 1
	case count <= 1:
		return 0, round
	}
	return index, round
}
