package ws

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"rollandplay/backend/internal/game"
)

const (
	maxCheckTitle   = 80
	maxCheckTargets = 50
)

// checkPrompt (DM only) asks room members with a character to roll a check against a DC.
// Body: {title?, kind, key, dc, targetUserIds, isPrivate}.
func (c *client) checkPrompt(msg clientEnvelope) {
	var req struct {
		Title         string   `json:"title"`
		Kind          string   `json:"kind"`
		Key           string   `json:"key"`
		DC            int      `json:"dc"`
		TargetUserIDs []string `json:"targetUserIds"`
		IsPrivate     bool     `json:"isPrivate"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "only game masters can prompt checks")
		return
	}
	check := game.Check{Kind: req.Kind, Key: req.Key}
	if err := check.Validate(); err != nil {
		c.error(msg.RequestID, "invalid_check", err.Error())
		return
	}
	title := strings.TrimSpace(req.Title)
	if utf8.RuneCountInString(title) > maxCheckTitle {
		c.error(msg.RequestID, "invalid_check", fmt.Sprintf("title must be at most %d characters", maxCheckTitle))
		return
	}
	if req.DC < 1 || req.DC > 100 {
		c.error(msg.RequestID, "invalid_check", "DC must be between 1 and 100")
		return
	}
	targets := uniqueStrings(req.TargetUserIDs)
	if len(targets) == 0 || len(targets) > maxCheckTargets {
		c.error(msg.RequestID, "invalid_check", fmt.Sprintf("choose between 1 and %d players", maxCheckTargets))
		return
	}
	for _, id := range targets {
		if _, err := uuid.Parse(id); err != nil {
			c.error(msg.RequestID, "invalid_target", "every target must be a room member with a character")
			return
		}
	}
	ctx := context.Background()
	rows, err := c.hub.pool.Query(ctx, `select coalesce(nullif(s.name,''),u.username) from room_members rm join users u on u.id=rm.user_id join sheets s on s.id=rm.sheet_id where rm.room_id=$1 and rm.user_id=any($2::uuid[]) order by lower(coalesce(nullif(s.name,''),u.username))`, c.roomID, targets)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	if len(names) != len(targets) {
		c.error(msg.RequestID, "invalid_target", "every target must be a room member with a character")
		return
	}

	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	checkID := uuid.New().String()
	if _, err := tx.Exec(ctx, `insert into room_checks(id,room_id,created_by,title,check_kind,check_key,dc,is_private) values($1,$2,$3,$4,$5,$6,$7,$8)`, checkID, c.roomID, c.userID, title, check.Kind, check.Key, req.DC, req.IsPrivate); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	if _, err := tx.Exec(ctx, `insert into room_check_targets(check_id,user_id) select $1, unnest($2::uuid[])`, checkID, targets); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	// A private announcement reaches every target, so it does not name the others.
	body := fmt.Sprintf("%s (DC %d) for %s", check.Label(), req.DC, strings.Join(names, ", "))
	recipients := []string{}
	if req.IsPrivate {
		body = fmt.Sprintf("%s (DC %d), privately", check.Label(), req.DC)
		recipients = targets
	}
	if title != "" {
		body = title + ": " + body
	}
	announcement, err := insertChat(ctx, tx, c.roomID, c.userID, "system", body, nil, recipients)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.publish(c.roomID, envelope{Type: "chat.message", RequestID: &msg.RequestID, Body: announcement})
	c.hub.publish(c.roomID, c.checkChanged(&msg.RequestID, checkID, recipients))
}

// checkRoll rolls a pending check for the sender, or for any target when sent by a DM, with
// optional advantage, disadvantage and bonus. Body: {checkId, userId?, mode?, bonus?}.
func (c *client) checkRoll(msg clientEnvelope) {
	var req struct {
		CheckID string `json:"checkId"`
		UserID  string `json:"userId"`
		game.RollOptions
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if err := req.RollOptions.Validate(); err != nil {
		c.error(msg.RequestID, "invalid_roll", err.Error())
		return
	}
	target := req.UserID
	if target == "" {
		target = c.userID
	}
	if target != c.userID && !c.isDM {
		c.error(msg.RequestID, "forbidden", "you can only roll your own checks")
		return
	}
	if _, err := uuid.Parse(req.CheckID); err != nil {
		c.error(msg.RequestID, "not_found", "check not found")
		return
	}
	if _, err := uuid.Parse(target); err != nil {
		c.error(msg.RequestID, "not_found", "this player was not asked to roll")
		return
	}
	ctx := context.Background()
	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var check game.Check
	var title string
	var dc int
	var isPrivate, closed bool
	err = tx.QueryRow(ctx, `select check_kind,check_key,title,dc,is_private,closed_at is not null from room_checks where id=$1 and room_id=$2 for update`, req.CheckID, c.roomID).Scan(&check.Kind, &check.Key, &title, &dc, &isPrivate, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		c.error(msg.RequestID, "not_found", "check not found")
		return
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	var rolled bool
	err = tx.QueryRow(ctx, `select roll is not null from room_check_targets where check_id=$1 and user_id=$2`, req.CheckID, target).Scan(&rolled)
	if errors.Is(err, pgx.ErrNoRows) {
		c.error(msg.RequestID, "not_found", "this player was not asked to roll")
		return
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	if rolled {
		c.error(msg.RequestID, "already_rolled", "this check was already rolled")
		return
	}
	if closed {
		c.error(msg.RequestID, "check_closed", "the game master closed this check")
		return
	}
	// The character currently assigned at this table is the one that rolls.
	var name string
	var data []byte
	err = tx.QueryRow(ctx, `select coalesce(nullif(s.name,''),u.username),s.data from room_members rm join users u on u.id=rm.user_id join sheets s on s.id=rm.sheet_id where rm.room_id=$1 and rm.user_id=$2`, c.roomID, target).Scan(&name, &data)
	if errors.Is(err, pgx.ErrNoRows) {
		c.error(msg.RequestID, "no_character", "assign a character at this table before rolling")
		return
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	var stats map[string]any
	_ = json.Unmarshal(data, &stats)
	rr, err := game.RollExpression(req.RollOptions.D20(check.Modifier(stats)), rand.Reader)
	if err != nil {
		c.error(msg.RequestID, "bad_roll", err.Error())
		return
	}
	success := rr.Total >= dc
	roll := game.CheckRoll{RollResult: rr, Check: game.CheckOutcome{CheckID: req.CheckID, Title: title, Label: check.Label(), DC: dc, Success: success, UserID: target, CharacterName: name}}
	rollJSON, _ := json.Marshal(roll)
	if _, err := tx.Exec(ctx, `update room_check_targets set roll=$3,success=$4,rolled_by=$5,rolled_at=now() where check_id=$1 and user_id=$2`, req.CheckID, target, rollJSON, success, c.userID); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	// The check closes itself once every target has rolled.
	if _, err := tx.Exec(ctx, `update room_checks set closed_at=now() where id=$1 and not exists(select 1 from room_check_targets where check_id=$1 and roll is null)`, req.CheckID); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	outcome := "failure"
	if success {
		outcome = "success"
	}
	dcNote := fmt.Sprintf("DC %d", dc)
	if note := req.RollOptions.Note(); note != "" {
		dcNote += ", " + note
	}
	body := fmt.Sprintf("%s: %s (%s), %s", name, check.Label(), dcNote, outcome)
	recipients := []string{}
	if isPrivate {
		recipients = []string{target}
	}
	result, err := insertChat(ctx, tx, c.roomID, c.userID, "roll", body, roll, recipients)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	checkRecipients, err := checkRecipients(ctx, tx, req.CheckID, isPrivate)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.publish(c.roomID, envelope{Type: "roll.result", RequestID: &msg.RequestID, Body: result})
	c.hub.publish(c.roomID, c.checkChanged(&msg.RequestID, req.CheckID, checkRecipients))
}

// checkClose (DM only) ends a check; targets who have not rolled can no longer roll.
// Body: {checkId}.
func (c *client) checkClose(msg clientEnvelope) {
	var req struct {
		CheckID string `json:"checkId"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "only game masters can close checks")
		return
	}
	if _, err := uuid.Parse(req.CheckID); err != nil {
		c.error(msg.RequestID, "not_found", "check not found")
		return
	}
	ctx := context.Background()
	var isPrivate bool
	err := c.hub.pool.QueryRow(ctx, `update room_checks set closed_at=coalesce(closed_at,now()) where id=$1 and room_id=$2 returning is_private`, req.CheckID, c.roomID).Scan(&isPrivate)
	if errors.Is(err, pgx.ErrNoRows) {
		c.error(msg.RequestID, "not_found", "check not found")
		return
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	recipients, err := checkRecipients(ctx, c.hub.pool, req.CheckID, isPrivate)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.hub.publish(c.roomID, c.checkChanged(&msg.RequestID, req.CheckID, recipients))
}

// checkChanged tells clients that may see the check to reload it; the HTTP room state
// filters private checks per viewer, so the event itself carries no results.
func (c *client) checkChanged(requestID *string, checkID string, recipients []string) envelope {
	return envelope{Type: "check.changed", RequestID: requestID, Body: map[string]any{"room_id": c.roomID, "check_id": checkID, "sender_user_id": c.userID, "recipient_user_ids": recipients}}
}

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func checkRecipients(ctx context.Context, q queryer, checkID string, isPrivate bool) ([]string, error) {
	if !isPrivate {
		return []string{}, nil
	}
	rows, err := q.Query(ctx, `select user_id::text from room_check_targets where check_id=$1`, checkID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func insertChat(ctx context.Context, tx pgx.Tx, roomID, senderID, kind, body string, roll any, recipients []string) (map[string]any, error) {
	id := uuid.New().String()
	var rollJSON []byte
	if roll != nil {
		rollJSON, _ = json.Marshal(roll)
	}
	if _, err := tx.Exec(ctx, `insert into chat_messages(id,room_id,sender_user_id,kind,body,roll) values($1,$2,$3,$4,$5,$6)`, id, roomID, senderID, kind, body, rollJSON); err != nil {
		return nil, err
	}
	if len(recipients) > 0 {
		if _, err := tx.Exec(ctx, `insert into chat_message_recipients(message_id,user_id) select $1, unnest($2::uuid[])`, id, recipients); err != nil {
			return nil, err
		}
	}
	return map[string]any{"id": id, "room_id": roomID, "sender_user_id": senderID, "kind": kind, "body": body, "roll": roll, "recipient_user_ids": recipients, "created_at": time.Now()}, nil
}

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
