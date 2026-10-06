package ws

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"

	"github.com/jackc/pgx/v5"

	"rollandplay/backend/internal/game"
)

// statsKey names the row holding a token's game stats: its sheet, or the token itself.
type statsKey struct {
	sheet bool
	id    string // sheets.id when sheet, else room_tokens.id
}

func tokenStatsKey(t game.Token) statsKey {
	if t.SheetID != "" {
		return statsKey{sheet: true, id: t.SheetID}
	}
	return statsKey{id: t.ID}
}

// lockStats locks and reads each stats row once, always in the same order (sheets first,
// then tokens, each by id) so concurrent actions cannot deadlock. Keys come back sorted.
func lockStats(ctx context.Context, tx pgx.Tx, keys []statsKey) (map[statsKey]map[string]any, []statsKey, error) {
	sorted := slices.Clone(keys)
	slices.SortFunc(sorted, func(a, b statsKey) int {
		if a.sheet != b.sheet {
			if a.sheet {
				return -1
			}
			return 1
		}
		return cmp.Compare(a.id, b.id)
	})
	sorted = slices.Compact(sorted)
	out := make(map[statsKey]map[string]any, len(sorted))
	for _, key := range sorted {
		query := `select attributes from room_tokens where id=$1 for update`
		if key.sheet {
			query = `select data from sheets where id=$1 for update`
		}
		var raw []byte
		if err := tx.QueryRow(ctx, query, key.id).Scan(&raw); err != nil {
			return nil, nil, err
		}
		stats := map[string]any{}
		_ = json.Unmarshal(raw, &stats)
		if stats == nil {
			stats = map[string]any{}
		}
		out[key] = stats
	}
	return out, sorted, nil
}

// writeStats merges patch into the stats row, like handleTokenPatch does.
func writeStats(ctx context.Context, tx pgx.Tx, key statsKey, patch map[string]any) error {
	encoded, err := json.Marshal(patch)
	if err != nil {
		return err
	}
	query := `update room_tokens set attributes=attributes||$2::jsonb,updated_at=now() where id=$1`
	if key.sheet {
		query = `update sheets set data=data||$2::jsonb,updated_at=now() where id=$1`
	}
	_, err = tx.Exec(ctx, query, key.id, json.RawMessage(encoded))
	return err
}

// statsTx holds locked stats during one action. apply changes them in place, so a later
// target sharing a stats row (two tokens on one sheet, a caster in their own blast) sees
// earlier changes; flush writes each changed row once.
type statsTx struct {
	current map[statsKey]map[string]any
	keys    []statsKey
	pending map[statsKey]map[string]any
}

func beginStats(ctx context.Context, tx pgx.Tx, keys []statsKey) (*statsTx, error) {
	current, sorted, err := lockStats(ctx, tx, keys)
	if err != nil {
		return nil, err
	}
	return &statsTx{current: current, keys: sorted, pending: map[statsKey]map[string]any{}}, nil
}

func (s *statsTx) apply(key statsKey, patch map[string]any) {
	if len(patch) == 0 {
		return
	}
	maps.Copy(s.current[key], patch)
	if s.pending[key] == nil {
		s.pending[key] = map[string]any{}
	}
	maps.Copy(s.pending[key], patch)
}

func (s *statsTx) flush(ctx context.Context, tx pgx.Tx) error {
	for _, key := range s.keys {
		if patch := s.pending[key]; patch != nil {
			if err := writeStats(ctx, tx, key, patch); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *statsTx) target(t game.Token) game.Target {
	return game.Target{TokenID: t.ID, Name: t.Name, Stats: s.current[tokenStatsKey(t)], SheetBacked: t.SheetID != ""}
}

var errInvalidActions = errors.New("invalid actions")

// lookupAction finds an attack, action or item definition in a character's stats.
func lookupAction(stats map[string]any, source, id string) (game.Action, error) {
	t := game.Token{Stats: stats}
	switch source {
	case "attack":
		list, err := t.AttackList()
		if err != nil {
			return game.Action{}, errInvalidActions
		}
		if i := slices.IndexFunc(list, func(a game.Attack) bool { return a.ID == id }); i >= 0 {
			return list[i].AsAction(), nil
		}
	case "action":
		list, err := t.ActionList()
		if err != nil {
			return game.Action{}, errInvalidActions
		}
		if i := slices.IndexFunc(list, func(a game.Action) bool { return a.ID == id }); i >= 0 {
			return list[i], nil
		}
	case "item":
		list, err := t.ItemList()
		if err != nil {
			return game.Action{}, errInvalidActions
		}
		if i := slices.IndexFunc(list, func(it game.Item) bool { return it.ID == id }); i >= 0 {
			return list[i].Action, nil
		}
	}
	return game.Action{}, game.ErrUnknownAction
}

func (c *client) actionLookupError(requestID string, err error) {
	switch {
	case errors.Is(err, errInvalidActions):
		c.error(requestID, "invalid_actions", "this character's actions are invalid; edit them and try again")
	case errors.Is(err, game.ErrUnknownAction):
		c.error(requestID, "unknown_action", "action not found")
	case errors.Is(err, game.ErrNoUses):
		c.error(requestID, "no_uses", "no uses left")
	default:
		c.error(requestID, "db", err.Error())
	}
}

// canActWith: the game master may act with any token, a player only with their own.
func (c *client) canActWith(t game.Token) bool { return c.isDM || t.OwnerUserID == c.userID }

// lockError reports a failure to lock stats; a row deleted since it was loaded is not found.
func (c *client) lockError(requestID string, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		c.error(requestID, "not_found", "token not found")
		return
	}
	c.error(requestID, "db", err.Error())
}

// actionResolve rolls an attack, action or item from a token the sender controls and
// applies its damage or healing to the targets' stats.
// Body: {sourceTokenId, source: attack|action|item, actionId, targetTokenId?, point?, mode?, bonus?};
// mode and bonus change attack rolls only.
func (c *client) actionResolve(msg clientEnvelope) {
	var req struct {
		SourceTokenID string      `json:"sourceTokenId"`
		Source        string      `json:"source"`
		ActionID      string      `json:"actionId"`
		TargetTokenID string      `json:"targetTokenId"`
		Point         *game.Point `json:"point"`
		game.RollOptions
	}
	if json.Unmarshal(msg.Body, &req) != nil || !slices.Contains([]string{"attack", "action", "item"}, req.Source) {
		c.error(msg.RequestID, "bad_json", "invalid body")
		return
	}
	if err := req.RollOptions.Validate(); err != nil {
		c.error(msg.RequestID, "invalid_roll", err.Error())
		return
	}
	ctx := context.Background()
	source, err := c.hub.loadToken(ctx, c.roomID, req.SourceTokenID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "source token not found")
		return
	}
	if !c.canActWith(source) {
		c.error(msg.RequestID, "forbidden", "you cannot act with this token")
		return
	}
	if game.IsDead(source.Stats) || game.IsDown(source.Stats) {
		c.error(msg.RequestID, "source_down", "this character cannot act right now")
		return
	}
	def, err := lookupAction(source.Stats, req.Source, req.ActionID)
	if err != nil {
		c.actionLookupError(msg.RequestID, err)
		return
	}
	if def.Kind != game.ActionAttack && !req.RollOptions.IsNormal() {
		c.error(msg.RequestID, "invalid_roll", "advantage, disadvantage and bonuses apply to attack rolls only")
		return
	}
	from := game.Point{X: source.X, Y: source.Y}
	structures, _ := c.hub.loadStructures(ctx, c.roomID)
	area := def.AreaRadiusM > 0
	var targets []game.Token
	if !area {
		if req.TargetTokenID == "" {
			c.error(msg.RequestID, "invalid_target", "choose a target")
			return
		}
		target, err := c.hub.loadToken(ctx, c.roomID, req.TargetTokenID)
		if err != nil || !c.isDM && target.IsHidden && target.OwnerUserID != c.userID {
			c.error(msg.RequestID, "not_found", "target token not found")
			return
		}
		if source.ID == target.ID && def.Kind != game.ActionHeal {
			c.error(msg.RequestID, "invalid_target", "a token cannot target itself")
			return
		}
		to := game.Point{X: target.X, Y: target.Y}
		if !game.InAttackRange(from, to, def.RangeM) {
			c.error(msg.RequestID, "out_of_range", "target is out of range")
			return
		}
		if !game.CanTarget(from, to, structures, source) {
			c.error(msg.RequestID, "blocked_target", "target is blocked")
			return
		}
		targets = []game.Token{target}
	} else {
		if req.Point == nil {
			c.error(msg.RequestID, "no_point", "choose where the area lands")
			return
		}
		point := *req.Point
		if !game.InAttackRange(from, point, def.RangeM) {
			c.error(msg.RequestID, "out_of_range", "that point is out of range")
			return
		}
		if !game.CanTarget(from, point, structures, source) {
			c.error(msg.RequestID, "blocked_target", "that point is blocked")
			return
		}
		tokens, err := LoadActiveTokens(ctx, c.hub.pool, c.roomID)
		if err != nil {
			c.error(msg.RequestID, "db", err.Error())
			return
		}
		for _, t := range tokens {
			center := game.Point{X: t.X, Y: t.Y}
			if (c.isDM || !t.IsHidden) && game.DistanceMeters(point, center) <= def.AreaRadiusM+1e-9 && game.CanTarget(point, center, structures, t) {
				targets = append(targets, t)
			}
		}
		slices.SortStableFunc(targets, func(a, b game.Token) int {
			da, db := game.DistanceMeters(point, game.Point{X: a.X, Y: a.Y}), game.DistanceMeters(point, game.Point{X: b.X, Y: b.Y})
			return cmp.Or(cmp.Compare(da, db), cmp.Compare(a.Name, b.Name))
		})
	}

	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	keys := []statsKey{tokenStatsKey(source)}
	for _, t := range targets {
		keys = append(keys, tokenStatsKey(t))
	}
	stats, err := beginStats(ctx, tx, keys)
	if err != nil {
		c.lockError(msg.RequestID, err)
		return
	}
	srcKey := tokenStatsKey(source)
	// Resolve again from the locked stats so a concurrent edit is never used stale.
	def, err = lookupAction(stats.current[srcKey], req.Source, req.ActionID)
	if err != nil {
		c.actionLookupError(msg.RequestID, err)
		return
	}
	resolved := game.ResolveAction(def, stats.current[srcKey])
	outcome := game.ActionOutcome{Name: def.Name, Kind: def.Kind, Source: req.Source, SourceTokenID: source.ID, DamageType: def.DamageType, Targets: []game.TargetOutcome{}}
	switch req.Source {
	case "action":
		list, left, err := game.ConsumeUse(stats.current[srcKey], req.ActionID)
		if err != nil {
			c.actionLookupError(msg.RequestID, err)
			return
		}
		stats.apply(srcKey, map[string]any{"actions": list})
		outcome.UsesLeft = left
	case "item":
		list, left, err := game.ConsumeItem(stats.current[srcKey], req.ActionID)
		if err != nil {
			c.actionLookupError(msg.RequestID, err)
			return
		}
		stats.apply(srcKey, map[string]any{"items": list})
		outcome.QuantityLeft = &left
	}

	var effectTotal int
	switch def.Kind {
	case game.ActionSave, game.ActionHeal:
		effect, err := game.RollEffect(resolved, rand.Reader)
		if err != nil {
			c.error(msg.RequestID, "bad_roll", err.Error())
			return
		}
		outcome.Effect, effectTotal = &effect, effect.Total
		if def.Kind == game.ActionSave {
			outcome.DC, outcome.SaveAbility = resolved.SaveDC, def.SaveAbility
		}
	}
	for _, t := range targets {
		target := stats.target(t)
		var out game.TargetOutcome
		var patch map[string]any
		switch def.Kind {
		case game.ActionAttack:
			out, outcome.Effect, patch, err = game.RollAttack(resolved, target, req.RollOptions, rand.Reader)
		case game.ActionSave:
			out, patch, err = game.ResolveSave(resolved, effectTotal, target, rand.Reader)
		case game.ActionHeal:
			out, patch = game.ApplyHealing(max(0, effectTotal), target)
		}
		if err != nil {
			c.error(msg.RequestID, "bad_roll", err.Error())
			return
		}
		stats.apply(tokenStatsKey(t), patch)
		// Hidden tokens caught in a game master's area are affected but never named to the table.
		if !(area && t.IsHidden) {
			outcome.Targets = append(outcome.Targets, out)
		}
	}
	if err := stats.flush(ctx, tx); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	var body string
	switch {
	case def.Kind == game.ActionAttack:
		body = fmt.Sprintf("%s attacks %s with %s", source.Name, targets[0].Name, def.Name)
	case area:
		body = fmt.Sprintf("%s uses %s", source.Name, def.Name)
	default:
		body = fmt.Sprintf("%s uses %s on %s", source.Name, def.Name, targets[0].Name)
	}
	c.finishRoll(ctx, tx, msg.RequestID, withNote(body, req.RollOptions), game.ActionRoll{Action: outcome}, true)
}

// withNote adds the roll options to a chat line, e.g. "Hero attacks Goblin with Sword (advantage)".
func withNote(body string, opts game.RollOptions) string {
	if note := opts.Note(); note != "" {
		return body + " (" + note + ")"
	}
	return body
}

// deathSave rolls a dying character's death saving throw. Body: {tokenId, mode?, bonus?}.
func (c *client) deathSave(msg clientEnvelope) {
	var req struct {
		TokenID string `json:"tokenId"`
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
	ctx := context.Background()
	token, err := c.hub.loadToken(ctx, c.roomID, req.TokenID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "token not found")
		return
	}
	if !c.canActWith(token) {
		c.error(msg.RequestID, "forbidden", "you cannot act with this token")
		return
	}
	dying := func(stats map[string]any) bool {
		return token.SheetID != "" && game.IsDown(stats) && !game.IsDead(stats) && !game.DeathSaveState(stats).Stable
	}
	if !dying(token.Stats) {
		c.error(msg.RequestID, "not_dying", "only a dying character makes death saves")
		return
	}
	tx, err := c.hub.pool.Begin(ctx)
	if err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	defer tx.Rollback(ctx)
	key := tokenStatsKey(token)
	stats, err := beginStats(ctx, tx, []statsKey{key})
	if err != nil {
		c.lockError(msg.RequestID, err)
		return
	}
	if !dying(stats.current[key]) {
		c.error(msg.RequestID, "not_dying", "only a dying character makes death saves")
		return
	}
	out, patch, err := game.DeathSave(stats.target(token), req.RollOptions, rand.Reader)
	if err != nil {
		c.error(msg.RequestID, "bad_roll", err.Error())
		return
	}
	stats.apply(key, patch)
	if err := stats.flush(ctx, tx); err != nil {
		c.error(msg.RequestID, "db", err.Error())
		return
	}
	roll := game.ActionRoll{Action: game.ActionOutcome{Name: "Death save", Kind: "death_save", Source: "death_save", SourceTokenID: token.ID, Targets: []game.TargetOutcome{out}}}
	c.finishRoll(ctx, tx, msg.RequestID, withNote(fmt.Sprintf("%s makes a death saving throw", token.Name), req.RollOptions), roll, true)
}

// checkQuick rolls an ability check, saving throw, skill check or attribute check for a token
// the sender controls, without a DC. Body: {tokenId, kind, key, mode?, bonus?}.
func (c *client) checkQuick(msg clientEnvelope) {
	var req struct {
		TokenID string `json:"tokenId"`
		Kind    string `json:"kind"`
		Key     string `json:"key"`
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
	ctx := context.Background()
	token, err := c.hub.loadToken(ctx, c.roomID, req.TokenID)
	if err != nil {
		c.error(msg.RequestID, "not_found", "token not found")
		return
	}
	if !c.canActWith(token) {
		c.error(msg.RequestID, "forbidden", "you cannot act with this token")
		return
	}
	check := game.Check{Kind: req.Kind, Key: req.Key}
	if err := check.Validate(); err != nil {
		c.error(msg.RequestID, "invalid_check", err.Error())
		return
	}
	if game.IsDead(token.Stats) || game.IsDown(token.Stats) {
		c.error(msg.RequestID, "source_down", "this character cannot act right now")
		return
	}
	roll, err := game.RollExpression(req.RollOptions.D20(check.Modifier(token.Stats)), rand.Reader)
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
	c.finishRoll(ctx, tx, msg.RequestID, withNote(fmt.Sprintf("%s: %s", token.Name, check.Label()), req.RollOptions), roll, false)
}

// finishRoll posts the roll to chat for everyone, commits, and broadcasts it. Rolls that
// changed stats bump the room version so state reloads see the new health.
func (c *client) finishRoll(ctx context.Context, tx pgx.Tx, requestID, body string, roll any, changedStats bool) {
	result, err := insertChat(ctx, tx, c.roomID, c.userID, "roll", body, roll, []string{})
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		c.error(requestID, "db", err.Error())
		return
	}
	if changedStats {
		c.hub.bump(c.roomID)
	}
	c.hub.publish(c.roomID, envelope{Type: "roll.result", RequestID: &requestID, Body: result})
}
