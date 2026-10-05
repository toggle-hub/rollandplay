package game

import (
	"slices"
	"testing"
)

func TestInitiativeModifier(t *testing.T) {
	tests := []struct {
		name  string
		stats map[string]any
		want  int
	}{
		{"a filled-in initiative wins", map[string]any{"initiative": 5.0, "dexterity": 14.0}, 5},
		{"a zero initiative falls back to dexterity", map[string]any{"initiative": 0.0, "dexterity": 16.0}, 3},
		{"no initiative uses dexterity", map[string]any{"dexterity": 8.0}, -1},
		{"a non-numeric initiative uses dexterity", map[string]any{"initiative": "fast", "dexterity": 12.0}, 1},
		{"an empty stat block has no modifier", map[string]any{}, 0},
	}
	for _, tt := range tests {
		if got := InitiativeModifier(tt.stats); got != tt.want {
			t.Errorf("%s: got %d, want %d", tt.name, got, tt.want)
		}
	}
}

func TestRollInitiative(t *testing.T) {
	init, err := RollInitiative("goblin", map[string]any{"dexterity": 14.0}, dice(11, 7))
	if err != nil || init.Roll.Expression != "1d20+2" || init.Roll.Total != 14 || init.Dexterity != 14 || init.Tiebreak != 7 || init.TokenID != "goblin" {
		t.Fatalf("initiative: %+v %v", init, err)
	}
}

func TestSortInitiativeBreaksTiesByDexterityThenAtRandom(t *testing.T) {
	entry := func(id string, total, dex int, tiebreak uint64) Initiative {
		return Initiative{TokenID: id, Roll: RollResult{Total: total}, Dexterity: dex, Tiebreak: tiebreak}
	}
	order := []Initiative{
		entry("slow", 4, 18, 9),
		entry("tie-low-dex", 15, 10, 9),
		entry("tie-lucky", 15, 14, 8),
		entry("fast", 21, 8, 0),
		entry("tie-unlucky", 15, 14, 2),
	}
	SortInitiative(order)
	got := make([]string, len(order))
	for i, e := range order {
		got[i] = e.TokenID
	}
	if want := []string{"fast", "tie-lucky", "tie-unlucky", "tie-low-dex", "slow"}; !slices.Equal(got, want) {
		t.Fatalf("order %v, want %v", got, want)
	}
}

func TestJoinIndex(t *testing.T) {
	order := []InitiativeTotals{{Total: 18, Dexterity: 12}, {Total: 12, Dexterity: 14}, {Total: 7, Dexterity: 10}}
	join := func(total, dex int) int {
		return JoinIndex(order, Initiative{Roll: RollResult{Total: total}, Dexterity: dex})
	}
	if got := join(20, 10); got != 0 {
		t.Errorf("the highest roll goes first: %d", got)
	}
	if got := join(12, 14); got != 2 {
		t.Errorf("a full tie goes after the combatant already there: %d", got)
	}
	if got := join(12, 16); got != 1 {
		t.Errorf("a tie with more dexterity goes before: %d", got)
	}
	if got := join(1, 20); got != 3 {
		t.Errorf("the lowest roll goes last: %d", got)
	}
	if got := JoinIndex(nil, Initiative{}); got != 0 {
		t.Errorf("an empty order takes the joiner first: %d", got)
	}
}

func TestNextTurnWrapsIntoANewRound(t *testing.T) {
	index, round := 0, 1
	var seen []int
	for range 4 {
		index, round = NextTurn(3, index, round)
		seen = append(seen, index, round)
	}
	if want := []int{1, 1, 2, 1, 0, 2, 1, 2}; !slices.Equal(seen, want) {
		t.Fatalf("turns %v, want %v", seen, want)
	}
	if index, round := NextTurn(0, 0, 4); index != 0 || round != 4 {
		t.Fatalf("an empty order keeps the round: %d %d", index, round)
	}
}

func TestAfterRemoval(t *testing.T) {
	tests := []struct {
		name                         string
		count, index, round, removed int
		wantIndex, wantRound         int
	}{
		{"someone earlier leaves: the current combatant keeps the turn", 4, 2, 3, 0, 1, 3},
		{"someone later leaves: nothing changes", 4, 1, 3, 3, 1, 3},
		{"the current combatant leaves: the next one takes the turn", 4, 1, 3, 1, 1, 3},
		{"the last in order leaves on their turn: a new round starts", 4, 3, 3, 3, 0, 4},
		{"the only combatant leaves", 1, 0, 2, 0, 0, 2},
	}
	for _, tt := range tests {
		index, round := AfterRemoval(tt.count, tt.index, tt.round, tt.removed)
		if index != tt.wantIndex || round != tt.wantRound {
			t.Errorf("%s: got %d/%d, want %d/%d", tt.name, index, round, tt.wantIndex, tt.wantRound)
		}
	}
}
