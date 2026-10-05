package httpapi

import "net/http"

// addDeathSaves checks the game master's death save edits and adds them to the sheet patch.
// Counts run from 0 to 3; three failures mean dead, and lowering them brings the character back.
func addDeathSaves(w http.ResponseWriter, patch map[string]any, successes, failures *int, stable *bool) bool {
	for _, field := range []struct {
		key   string
		value *int
	}{{"death_save_successes", successes}, {"death_save_failures", failures}} {
		if field.value == nil {
			continue
		}
		if *field.value < 0 || *field.value > 3 {
			WriteError(w, 400, "invalid_token", field.key+" must be a whole number from 0 to 3")
			return false
		}
		patch[field.key] = *field.value
	}
	if failures != nil {
		patch["dead"] = *failures >= 3
	}
	if stable != nil {
		patch["stable"] = *stable
	}
	return true
}
