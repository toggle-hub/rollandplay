package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// handleRuleBookDelete lets a rule book's owner delete it while no room or character uses it.
// Built-in books can't be deleted; editors may change a book but not delete it.
func (s *Server) handleRuleBookDelete(w http.ResponseWriter, r *http.Request) {
	u, _, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("ruleBookID")
	if _, err := uuid.Parse(id); err != nil {
		WriteError(w, 404, "not_found", "rule book not found")
		return
	}
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	// Lock the book so no room or character can start using it between the in-use check and the delete.
	var name string
	var builtIn, isOwner bool
	err = tx.QueryRow(r.Context(), `select name, owner_id is null, owner_id is not distinct from $2 from rule_books where id=$1 and `+ruleBookReadable("$2")+` for update`, id, u.ID).Scan(&name, &builtIn, &isOwner)
	if errors.Is(err, pgx.ErrNoRows) {
		WriteError(w, 404, "not_found", "rule book not found")
		return
	}
	if err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if builtIn {
		WriteError(w, 403, "forbidden", "Built-in rule books can't be deleted.")
		return
	}
	if !isOwner {
		WriteError(w, 403, "forbidden", "Only the rule book's owner can delete it.")
		return
	}
	var rooms, characters int
	if err := tx.QueryRow(r.Context(), `select (select count(*) from rooms where rule_book_id=$1), (select count(*) from sheets where rule_book_id=$1)`, id).Scan(&rooms, &characters); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if rooms > 0 || characters > 0 {
		WriteError(w, 409, "rule_book_in_use", fmt.Sprintf("“%s” is still used by %s, so it can't be deleted. Delete those first, or keep the book.", name, ruleBookUsage(rooms, characters)))
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from rule_books where id=$1`, id); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		WriteError(w, 500, "db", err.Error())
		return
	}
	w.WriteHeader(204)
}

// ruleBookUsage describes what uses a rule book, such as "2 rooms and 1 character".
func ruleBookUsage(rooms, characters int) string {
	var parts []string
	if rooms > 0 {
		parts = append(parts, countOf(rooms, "room", "rooms"))
	}
	if characters > 0 {
		parts = append(parts, countOf(characters, "character", "characters"))
	}
	return strings.Join(parts, " and ")
}

func countOf(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}
