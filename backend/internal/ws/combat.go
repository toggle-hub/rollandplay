package ws

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"rollandplay/backend/internal/game"
)

// maxCombatants bounds one fight's turn order.
const maxCombatants = 100

// Combat is the running fight on a room's active map, in turn order.
type Combat struct {
	Round int `json:"round"`
	// CurrentCombatantID is whose turn it is; nil when the order is empty, or for players while a
	// hidden token acts.
	CurrentCombatantID *string     `json:"current_combatant_id"`
	Combatants         []Combatant `json:"combatants"`
	current            int         // index into Combatants of whose turn it is
}

type Combatant struct {
	ID         string `json:"id"`
	TokenID    string `json:"token_id"`
	Name       string `json:"name"`
	Initiative int    `json:"initiative"`
	// PlayerUserID is who plays this combatant: the owner of its character sheet, else the owner
	// of the token. That player may end the combatant's turn.
	PlayerUserID string `json:"player_user_id"`
	IsHidden     bool   `json:"is_hidden"`
}

// Current is the combatant whose turn it is, or nil when the order is empty.
func (c *Combat) Current() *Combatant {
	if c == nil || c.current >= len(c.Combatants) {
		return nil
	}
	return &c.Combatants[c.current]
}

func (c *Combat) indexOf(combatantID string) int {
	return slices.IndexFunc(c.Combatants, func(cb Combatant) bool { return cb.ID == combatantID })
}

func (c *Combat) syncCurrentID() {
	c.CurrentCombatantID = nil
	if cur := c.Current(); cur != nil {
		id := cur.ID
		c.CurrentCombatantID = &id
	}
}

// ForViewer is the fight as one viewer may see it: game masters see everything, players never
// see hidden tokens, nor whose turn it is while a hidden token acts.
func (c *Combat) ForViewer(isDM bool) *Combat {
	if c == nil || isDM {
		return c
	}
	out := &Combat{Round: c.Round, Combatants: []Combatant{}}
	for _, cb := range c.Combatants {
		if !cb.IsHidden {
			out.Combatants = append(out.Combatants, cb)
		}
	}
	if cur := c.Current(); cur != nil && !cur.IsHidden {
		out.CurrentCombatantID = c.CurrentCombatantID
	}
	return out
}

type combatQueryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// LoadCombat reads the room's fight when it runs on the active map, else nil. The turn belongs to
// the first combatant at or after the stored position, so a token deleted mid-turn passes the
// turn on. forUpdate locks the fight so changes to it apply one at a time.
func LoadCombat(ctx context.Context, q combatQueryer, roomID string, forUpdate bool) (*Combat, error) {
	query := `select rc.round,rc.current_position from room_combats rc join room_maps rm on rm.id=rc.room_map_id and rm.is_active where rc.room_id=$1`
	if forUpdate {
		query += ` for update of rc`
	}
	combat := &Combat{Combatants: []Combatant{}}
	var currentPosition int
	err := q.QueryRow(ctx, query, roomID).Scan(&combat.Round, &currentPosition)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `select c.id::text,c.token_id::text,rt.name,c.initiative,coalesce(s.user_id::text,rt.owner_user_id::text,''),rt.is_hidden,c.position from room_combatants c join room_tokens rt on rt.id=c.token_id left join sheets s on s.id=rt.sheet_id where c.room_id=$1 order by c.position,c.id`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	combat.current = -1
	for rows.Next() {
		var cb Combatant
		var position int
		if err := rows.Scan(&cb.ID, &cb.TokenID, &cb.Name, &cb.Initiative, &cb.PlayerUserID, &cb.IsHidden, &position); err != nil {
			return nil, err
		}
		if combat.current < 0 && position >= currentPosition {
			combat.current = len(combat.Combatants)
		}
		combat.Combatants = append(combat.Combatants, cb)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if combat.current < 0 {
		combat.current = 0
	}
	combat.syncCurrentID()
	return combat, nil
}

// saveCombat stores the turn order as positions 0..n-1, with the round and whose turn it is.
func saveCombat(ctx context.Context, tx pgx.Tx, roomID string, combat *Combat) error {
	ids := make([]string, len(combat.Combatants))
	for i, cb := range combat.Combatants {
		ids[i] = cb.ID
	}
	if _, err := tx.Exec(ctx, `update room_combatants c set position=o.n-1 from unnest($2::uuid[]) with ordinality as o(id,n) where c.room_id=$1 and c.id=o.id`, roomID, ids); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `update room_combats set round=$2,current_position=$3,updated_at=now() where room_id=$1`, roomID, combat.Round, combat.current)
	return err
}

// turnLine announces whose turn it is. A hidden token's turn is never named; it is announced only
// when it starts a round. The empty string means there is nothing to announce.
func turnLine(combat *Combat, roundChanged bool) string {
	cur := combat.Current()
	switch {
	case cur != nil && !cur.IsHidden:
		return fmt.Sprintf("Round %d: %s's turn.", combat.Round, cur.Name)
	case roundChanged:
		return fmt.Sprintf("Round %d begins.", combat.Round)
	}
	return ""
}

// initiativeList names visible combatants with their initiative, e.g. "Aria 17, Goblin 12".
func initiativeList(combatants []Combatant) string {
	var parts []string
	for _, cb := range combatants {
		if !cb.IsHidden {
			parts = append(parts, fmt.Sprintf("%s %d", cb.Name, cb.Initiative))
		}
	}
	return strings.Join(parts, ", ")
}

// combatTokens validates requested token IDs against the tokens on the room's active map.
func (c *client) combatTokens(ctx context.Context, requestID string, ids []string) ([]game.Token, bool) {
	ids = uniqueStrings(ids)
	if len(ids) == 0 || len(ids) > maxCombatants {
		c.error(requestID, "invalid_combat", fmt.Sprintf("choose between 1 and %d tokens", maxCombatants))
		return nil, false
	}
	tokens, err := LoadActiveTokens(ctx, c.hub.pool, c.roomID)
	if err != nil {
		c.error(requestID, "db", err.Error())
		return nil, false
	}
	picked := make([]game.Token, 0, len(ids))
	for _, id := range ids {
		i := slices.IndexFunc(tokens, func(t game.Token) bool { return t.ID == id })
		if i < 0 {
			c.error(requestID, "invalid_target", "every combatant must be a token on the active map")
			return nil, false
		}
		picked = append(picked, tokens[i])
	}
	return picked, true
}

func rollInitiatives(tokens []game.Token) ([]game.Initiative, error) {
	order := make([]game.Initiative, 0, len(tokens))
	for _, t := range tokens {
		init, err := game.RollInitiative(t.ID, t.Stats, rand.Reader)
		if err != nil {
			return nil, err
		}
		order = append(order, init)
	}
	game.SortInitiative(order)
	return order, nil
}

func insertCombatant(ctx context.Context, tx pgx.Tx, roomID string, position int, init game.Initiative) (string, error) {
	id := uuid.New().String()
	roll, _ := json.Marshal(init.Roll)
	_, err := tx.Exec(ctx, `insert into room_combatants(id,room_id,token_id,position,initiative,roll) values($1,$2,$3,$4,$5,$6)`, id, roomID, init.TokenID, position, init.Roll.Total, json.RawMessage(roll))
	return id, err
}

// finishCombat posts the announcement (if any), commits, and tells the room to reload the fight.
func (c *client) finishCombat(ctx context.Context, tx pgx.Tx, requestID, announcement string) {
	var chat map[string]any
	var err error
	if announcement != "" {
		chat, err = insertChat(ctx, tx, c.roomID, c.userID, "system", announcement, nil, []string{})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		c.error(requestID, "db", err.Error())
		return
	}
	if chat != nil {
		c.hub.publish(c.roomID, envelope{Type: "chat.message", RequestID: &requestID, Body: chat})
	}
	c.hub.publish(c.roomID, envelope{Type: "combat.changed", RequestID: &requestID, Body: map[string]any{"room_id": c.roomID}})
}

// beginCombatChange (game masters only) opens a transaction holding the running fight's lock.
func (c *client) beginCombatChange(ctx context.Context, requestID string) (pgx.Tx, *Combat, bool) {
	if !c.isDM {
		c.error(requestID, "forbidden", "only game masters can run combat")
		return nil, nil, false
	}
	return c.lockCombat(ctx, requestID)
}

func (c *client) lockCombat(ctx context.Context, requestID string) (pgx.Tx, *Combat, bool) {
	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(requestID, "db", err.Error())
		return nil, nil, false
	}
	combat, err := LoadCombat(ctx, tx, c.roomID, true)
	if err == nil && combat == nil {
		_ = tx.Rollback(ctx)
		c.error(requestID, "no_combat", "no combat is running on this map")
		return nil, nil, false
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		c.error(requestID, "db", err.Error())
		return nil, nil, false
	}
	return tx, combat, true
}

// combatStart (game masters only) rolls initiative for tokens on the active map and starts a fight
// on it. A fight left running on another map is replaced. Body: {tokenIds}.
func (c *client) combatStart(msg clientEnvelope) {
	var req struct {
		TokenIDs []string `json:"tokenIds"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if !c.isDM {
		c.error(msg.RequestID, "forbidden", "only game masters can run combat")
		return
	}
	ctx := context.Background()
	tokens, ok := c.combatTokens(ctx, msg.RequestID, req.TokenIDs)
	if !ok {
		return
	}
	order, err := rollInitiatives(tokens)
	if err != nil {
		c.error(msg.RequestID, "bad_roll", err.Error())
		return
	}
	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var roomMapID string
	err = tx.QueryRow(ctx, `select id::text from room_maps where room_id=$1 and is_active`, c.roomID).Scan(&roomMapID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.error(msg.RequestID, "no_active_map", "choose a map before starting combat")
		return
	}
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	if _, err := tx.Exec(ctx, `delete from room_combats where room_id=$1 and room_map_id<>$2`, c.roomID, roomMapID); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	started, err := tx.Exec(ctx, `insert into room_combats(room_id,room_map_id,started_by) values($1,$2,$3) on conflict(room_id) do nothing`, c.roomID, roomMapID, c.userID)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	if started.RowsAffected() == 0 {
		c.error(msg.RequestID, "combat_running", "combat is already running; end it before starting another")
		return
	}
	for i, init := range order {
		if _, err := insertCombatant(ctx, tx, c.roomID, i, init); err != nil {
			c.error(msg.RequestID, "db", err.Error())
			return
		}
	}
	combat, err := LoadCombat(ctx, tx, c.roomID, false)
	if err != nil || combat == nil {
		c.error(msg.RequestID, "db", fmt.Sprint("load started combat: ", err))
		return
	}
	announcement := "Combat begins!"
	if list := initiativeList(combat.Combatants); list != "" {
		announcement += " Initiative: " + list + "."
	}
	if line := turnLine(combat, true); line != "" {
		announcement += " " + line
	}
	c.finishCombat(ctx, tx, msg.RequestID, announcement)
}

// combatNext ends the current turn: the game master may end anyone's, a player only their own.
// combatantId names the turn being ended, so a second press after the turn moved on does
// nothing. Body: {combatantId}.
func (c *client) combatNext(msg clientEnvelope) {
	var req struct {
		CombatantID string `json:"combatantId"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	ctx := context.Background()
	tx, combat, ok := c.lockCombat(ctx, msg.RequestID)
	if !ok {
		return
	}
	defer tx.Rollback(ctx)
	cur := combat.Current()
	if cur == nil {
		c.error(msg.RequestID, "no_combat", "nobody is in the turn order")
		return
	}
	if cur.ID != req.CombatantID {
		c.error(msg.RequestID, "stale_turn", "the turn has already moved on")
		return
	}
	if !c.isDM && cur.PlayerUserID != c.userID {
		c.error(msg.RequestID, "forbidden", "only the game master or the player whose turn it is can end the turn")
		return
	}
	round := combat.Round
	combat.current, combat.Round = game.NextTurn(len(combat.Combatants), combat.current, combat.Round)
	if err := saveCombat(ctx, tx, c.roomID, combat); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.finishCombat(ctx, tx, msg.RequestID, turnLine(combat, combat.Round != round))
}

// combatAdd (game masters only) rolls initiative for tokens joining the running fight and slots
// them into the order after everyone who beats or ties them. Body: {tokenIds}.
func (c *client) combatAdd(msg clientEnvelope) {
	var req struct {
		TokenIDs []string `json:"tokenIds"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	ctx := context.Background()
	tokens, ok := c.combatTokens(ctx, msg.RequestID, req.TokenIDs)
	if !ok {
		return
	}
	tx, combat, ok := c.beginCombatChange(ctx, msg.RequestID)
	if !ok {
		return
	}
	defer tx.Rollback(ctx)
	tokens = slices.DeleteFunc(tokens, func(t game.Token) bool {
		return slices.ContainsFunc(combat.Combatants, func(cb Combatant) bool { return cb.TokenID == t.ID })
	})
	if len(tokens) == 0 {
		c.error(msg.RequestID, "invalid_combat", "those tokens are already in the fight")
		return
	}
	if len(combat.Combatants)+len(tokens) > maxCombatants {
		c.error(msg.RequestID, "invalid_combat", fmt.Sprintf("a fight holds at most %d combatants", maxCombatants))
		return
	}
	joining, err := rollInitiatives(tokens)
	if err != nil {
		c.error(msg.RequestID, "bad_roll", err.Error())
		return
	}
	all, err := LoadActiveTokens(ctx, c.hub.pool, c.roomID)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	dexterity := map[string]int{}
	for _, t := range all {
		dexterity[t.ID] = game.DexterityScore(t.Stats)
	}
	totals := make([]game.InitiativeTotals, len(combat.Combatants))
	for i, cb := range combat.Combatants {
		totals[i] = game.InitiativeTotals{Total: cb.Initiative, Dexterity: dexterity[cb.TokenID]}
	}
	names := make([]string, 0, len(tokens))
	for _, init := range joining {
		id, err := insertCombatant(ctx, tx, c.roomID, -1, init)
		if err != nil {
			c.error(msg.RequestID, "db", err.Error())
			return
		}
		token := tokens[slices.IndexFunc(tokens, func(t game.Token) bool { return t.ID == init.TokenID })]
		at := game.JoinIndex(totals, init)
		if len(combat.Combatants) > 0 && at <= combat.current {
			combat.current++
		}
		totals = slices.Insert(totals, at, game.InitiativeTotals{Total: init.Roll.Total, Dexterity: init.Dexterity})
		combat.Combatants = slices.Insert(combat.Combatants, at, Combatant{ID: id, TokenID: token.ID, Name: token.Name, Initiative: init.Roll.Total, IsHidden: token.IsHidden})
		if !token.IsHidden {
			names = append(names, fmt.Sprintf("%s (%d)", token.Name, init.Roll.Total))
		}
	}
	if err := saveCombat(ctx, tx, c.roomID, combat); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	announcement := ""
	switch len(names) {
	case 0:
	case 1:
		announcement = names[0] + " joins the fight."
	default:
		announcement = strings.Join(names, ", ") + " join the fight."
	}
	c.finishCombat(ctx, tx, msg.RequestID, announcement)
}

// combatRemove (game masters only) takes a combatant out of the order. Removing the combatant
// whose turn it is passes the turn on. Body: {combatantId}.
func (c *client) combatRemove(msg clientEnvelope) {
	var req struct {
		CombatantID string `json:"combatantId"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	ctx := context.Background()
	tx, combat, ok := c.beginCombatChange(ctx, msg.RequestID)
	if !ok {
		return
	}
	defer tx.Rollback(ctx)
	removed := combat.indexOf(req.CombatantID)
	if removed < 0 {
		c.error(msg.RequestID, "not_found", "combatant not found")
		return
	}
	if _, err := tx.Exec(ctx, `delete from room_combatants where id=$1`, req.CombatantID); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	wasCurrent, round := removed == combat.current, combat.Round
	combat.current, combat.Round = game.AfterRemoval(len(combat.Combatants), combat.current, combat.Round, removed)
	combat.Combatants = slices.Delete(combat.Combatants, removed, removed+1)
	if err := saveCombat(ctx, tx, c.roomID, combat); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	announcement := ""
	if wasCurrent {
		announcement = turnLine(combat, combat.Round != round)
	}
	c.finishCombat(ctx, tx, msg.RequestID, announcement)
}

// combatMove (game masters only) moves a combatant to another place in the order; the turn stays
// with whoever has it. Body: {combatantId, toIndex}.
func (c *client) combatMove(msg clientEnvelope) {
	var req struct {
		CombatantID string `json:"combatantId"`
		ToIndex     int    `json:"toIndex"`
	}
	if json.Unmarshal(msg.Body, &req) != nil {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	ctx := context.Background()
	tx, combat, ok := c.beginCombatChange(ctx, msg.RequestID)
	if !ok {
		return
	}
	defer tx.Rollback(ctx)
	from := combat.indexOf(req.CombatantID)
	if from < 0 {
		c.error(msg.RequestID, "not_found", "combatant not found")
		return
	}
	if req.ToIndex < 0 || req.ToIndex >= len(combat.Combatants) {
		c.error(msg.RequestID, "invalid_combat", "that place is outside the turn order")
		return
	}
	currentID := combat.Current().ID
	moved := combat.Combatants[from]
	combat.Combatants = slices.Insert(slices.Delete(combat.Combatants, from, from+1), req.ToIndex, moved)
	combat.current = combat.indexOf(currentID)
	if err := saveCombat(ctx, tx, c.roomID, combat); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	c.finishCombat(ctx, tx, msg.RequestID, "")
}

// combatEnd (game masters only) ends the running fight. Body: {}.
func (c *client) combatEnd(msg clientEnvelope) {
	ctx := context.Background()
	tx, combat, ok := c.beginCombatChange(ctx, msg.RequestID)
	if !ok {
		return
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from room_combats where room_id=$1`, c.roomID); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	rounds := "1 round"
	if combat.Round != 1 {
		rounds = fmt.Sprintf("%d rounds", combat.Round)
	}
	c.finishCombat(ctx, tx, msg.RequestID, "Combat ends after "+rounds+".")
}
