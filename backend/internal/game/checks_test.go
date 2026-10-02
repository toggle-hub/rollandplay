package game

import "testing"

func TestCheckModifier(t *testing.T) {
	rogue := map[string]any{
		"dexterity": 16.0, "wisdom": 9.0, "strength": 8.0, "proficiency_bonus": 3.0, "speed_m": 9.0,
		"saving_throw_proficiencies": map[string]any{"dexterity": true, "wisdom": false},
		"skill_proficiencies":        map[string]any{"stealth": true, "perception": false},
	}
	tests := []struct {
		name  string
		check Check
		stats map[string]any
		want  int
		expr  string
		label string
	}{
		{"ability check uses the ability modifier only", Check{CheckAbility, "dexterity"}, rogue, 3, "1d20+3", "Dexterity check"},
		{"proficient save adds the proficiency bonus", Check{CheckSave, "dexterity"}, rogue, 6, "1d20+6", "Dexterity saving throw"},
		{"non-proficient save rounds the modifier down", Check{CheckSave, "wisdom"}, rogue, -1, "1d20-1", "Wisdom saving throw"},
		{"proficient skill uses its ability plus proficiency", Check{CheckSkill, "stealth"}, rogue, 6, "1d20+6", "Stealth check"},
		{"non-proficient skill uses its ability", Check{CheckSkill, "perception"}, rogue, -1, "1d20-1", "Perception check"},
		{"skill ability can be negative", Check{CheckSkill, "athletics"}, rogue, -1, "1d20-1", "Athletics check"},
		{"attribute value is added as-is", Check{CheckAttribute, "speed_m"}, rogue, 9, "1d20+9", "Speed m check"},
		{"missing attribute counts as zero", Check{CheckAttribute, "sanity"}, rogue, 0, "1d20", "Sanity check"},
		{"empty sheet has no modifier", Check{CheckSave, "charisma"}, map[string]any{}, 0, "1d20", "Charisma saving throw"},
		{"proficiency without a bonus adds nothing", Check{CheckSkill, "stealth"}, map[string]any{"dexterity": 12.0, "skill_proficiencies": map[string]any{"stealth": true}}, 1, "1d20+1", "Stealth check"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.check.Validate(); err != nil {
				t.Fatalf("valid check rejected: %v", err)
			}
			if got := tt.check.Modifier(tt.stats); got != tt.want {
				t.Fatalf("modifier = %d, want %d", got, tt.want)
			}
			if got := tt.check.Expression(tt.stats); got != tt.expr {
				t.Fatalf("expression = %q, want %q", got, tt.expr)
			}
			if got := tt.check.Label(); got != tt.label {
				t.Fatalf("label = %q, want %q", got, tt.label)
			}
		})
	}
}

func TestCheckValidateRejects(t *testing.T) {
	for _, c := range []Check{
		{CheckAbility, "luck"},
		{CheckSave, "stealth"},
		{CheckSkill, "dexterity"},
		{CheckAttribute, "Speed"},
		{CheckAttribute, "a.b"},
		{CheckAttribute, ""},
		{"initiative", "dexterity"},
	} {
		if c.Validate() == nil {
			t.Errorf("%+v: expected validation error", c)
		}
	}
}

func TestSkillAbilitiesAreAbilities(t *testing.T) {
	if len(DnDSkillAbility) != 18 {
		t.Fatalf("expected the 18 built-in skills, got %d", len(DnDSkillAbility))
	}
	for skill, ability := range DnDSkillAbility {
		if !isAbility(ability) {
			t.Errorf("%s maps to unknown ability %s", skill, ability)
		}
	}
}
