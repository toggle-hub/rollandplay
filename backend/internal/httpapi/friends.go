package httpapi

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// friendsBetween is a predicate: an accepted friends row joins the users bound to a and b.
func friendsBetween(a, b string) string {
	return `exists(select 1 from friends ff where ff.status='accepted' and ((ff.requester_user_id=` + a + ` and ff.addressee_user_id=` + b + `) or (ff.requester_user_id=` + b + ` and ff.addressee_user_id=` + a + `)))`
}

// userIDByUsername finds a player with a finished profile by username. An exact match wins;
// otherwise a match ignoring case counts only when it is the only one. No match is pgx.ErrNoRows.
func (s *Server) userIDByUsername(ctx context.Context, username string) (string, error) {
	type match struct {
		ID    string
		Exact bool
	}
	rows, err := s.Pool.Query(ctx, `select id::text, username=$1 from users where profile_complete and lower(username)=lower($1) order by username=$1 desc limit 2`, username)
	if err != nil {
		return "", err
	}
	matches, err := pgx.CollectRows(rows, pgx.RowToStructByPos[match])
	if err != nil {
		return "", err
	}
	if len(matches) == 0 || (!matches[0].Exact && len(matches) > 1) {
		return "", pgx.ErrNoRows
	}
	return matches[0].ID, nil
}
