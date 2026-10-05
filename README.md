# Rollandplay

Rollandplay is a TTRPG hosting platform with a Go backend, Postgres, Redis, SMTP magic-link email, websocket room updates, and a React/Vite frontend.

## Frontend experience and access

The public `/` page introduces Rollandplay with responsive editorial layouts, bundled Outfit typography, and GSAP scroll animation. Images are served by Picsum; reduced-motion preferences disable the animated entrances, marquee, image transforms, and pinned layout.

The shared frontend palette uses pink `#ffa9a9` for alerts and headline highlights, green `#d9ffb5` for success and terrain, peach `#ffb887` for warm accents and doors, purple `#be8cff` for primary actions and walls, and lavender `#ebc7ff` for secondary accents and windows. Map cover uses pink. Dark neutral surfaces and contrasting text keep pastel controls readable; theme variables live in `frontend/src/index.css`.

Rooms, friends, rule books, character sheets, maps, and map editors are available only after `/api/me` confirms a session. While that check is pending or fails, neither feature navigation nor feature screens mount. Connection failures offer a retry; a protected API response with status `401` that a token refresh can't fix removes the workspace and returns to sign-in. Backend authorization remains the security boundary.

Sign-in uses an email magic link. A protected URL opened before sign-in is remembered in the current tab and restored afterward; otherwise sign-in opens `/rooms`. Sign out revokes the session and returns to the public landing page. On smaller screens, authenticated navigation is available through the menu button.

A sign-in is two httpOnly cookies:

- **Access token** (`SESSION_COOKIE_NAME`, path `/`, `SameSite=Lax`): sent with every request and websocket connection. It lasts `ACCESS_TOKEN_TTL_MINUTES` (default 15).
- **Refresh token** (`<SESSION_COOKIE_NAME>_refresh`, path `/api/auth`, `SameSite=Strict`): sent only to `POST /api/auth/refresh` and `POST /api/auth/logout`. It lasts `SESSION_TTL_HOURS` (default 720) since its last use.

`POST /api/auth/refresh` issues a new access token, rotates the refresh token and answers `{"access_expires_in": seconds}`. While signed in, the frontend refreshes a minute before the access token expires, so images and new websocket connections keep working; any request that still gets a `401` is refreshed once and repeated. A refresh token that was already rotated still works for 30 seconds, so tabs refreshing at the same moment don't sign each other out. Used later than that, it counts as stolen: the whole sign-in is revoked and every tab returns to sign-in. `POST /api/auth/logout` revokes the sign-in through either cookie and clears both. Both cookies are `Secure` when `PUBLIC_BASE_URL` is `https://`. Migration `013_refresh_tokens.sql` removes existing sessions, so everyone signs in again once after deploying it.

Workspace forms expose loading, empty, and error states. JSON editors report malformed input without discarding it. The map editor works like a stamp-and-arrange tool with two tools. The Place tool (B) shows the active brush as a dashed ghost under the pointer, and every click saves one structure; Q/E rotate the stamp by 15°, [ and ] resize it by 10%, and the Place panel's Stamp rotation (°) and Stamp scale (%) inputs set it exactly. The Select tool (V) picks structures: click one, Shift-click (or Ctrl/Cmd-click) to add or remove it, or drag across empty space to select every structure the area touches. Grouped structures (Ctrl/Cmd+G groups the selection, Ctrl/Cmd+Shift+G ungroups it) are always selected and transformed together. The selection shows a dashed frame with square corner handles and a round rotation handle above it: drag inside the frame to move it (Shift locks to one axis), drag a corner to scale around the opposite corner, or drag the round handle to rotate around the frame center (Shift snaps to 15°). A lone two-point wall stretches from the grabbed endpoint. The Selection panel edits type, blocking flags, rotation, scale, flips, grouping and draw order; right-clicking a structure opens the same actions (duplicate, copy, bring to front, send to back, group, ungroup, delete). Keyboard shortcuts: Ctrl/Cmd+C/V/D copy, paste (offset by one grid square per paste) and duplicate; Ctrl/Cmd+A selects everything; arrow keys nudge by 0.1 m (Shift: one grid square); Q/E and [ ] rotate and scale the selection; Delete or Backspace removes it; Escape returns to Select or clears the selection; Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z (or Ctrl/Cmd+Y) redoes, also from the toolbar's History buttons. Scroll to zoom around the pointer, and drag with the right or middle mouse button (or hold Space and drag) to pan. Structures keep a draw order (`z_index`, higher draws on top, new structures go on top) and an optional `group_id`; both are accepted by `POST`/`PATCH /api/maps/{mapID}/structures`, and `"group_id": null` clears a group. The "Add from JSON" form saves a structure from pasted or imported geometry, and the whole map exports as JSON. Map owners can delete a map from the map list or the editor's Map settings after confirming (`DELETE /api/maps/{mapID}`); editors cannot, and a map still attached to a room is refused with `409 map_in_use`. Rooms let game masters attach an active map, and DM token placement does not require a character sheet. The tabletop canvas supports pointer interaction at responsive sizes, and game-master controls use the signed-in user identity rather than a fixed local user.

Map settings expose positive width and height values in meters; each change saves on blur and redraws the playable canvas boundary.

Every room plays with one rule book, chosen when the room is created (the built-in D&D book is preselected) and shown in the room list and room header. Joining is two steps: **Find room** previews the invite's room name and rule book, asks for the password only when the room has one, and lists your characters for that rule book. One matching character is chosen automatically; with several, pick one. Without a matching character, **Join and create a character** joins the room and opens the character creator locked to the room's rule book; creating the character returns you to the room with it chosen. **Enter the room without a character** skips this. Game masters skip the character step.

Inside a room, players see only their own characters for the room's rule book, both under **Your character** in the members panel and in the token form; game masters see their own and public sheets for that book. Choosing **No sheet** clears the character.

`GET /api/rooms` lists only rooms you created or joined; add `?public=true` to also include other users' public rooms. Another user's private room never appears in the list, so its invite code is not exposed. To join it you need the invite code and, if the room has one, its password.

Room API: room responses include `rule_book: {id, name}`. `POST /api/rooms` accepts `rule_book_id` (defaults to the built-in book; it must be readable by the creator). `GET /api/invites/{code}` returns `{room_id, name, rule_book, requires_password, member}`, where `member` is `null` before joining or `{is_dm, sheet_id}`. `POST /api/rooms/join` accepts an optional `sheet_id` and returns `{room_id, rule_book, is_dm, sheet_id}`; rejoining without `sheet_id` keeps the current character. `PATCH /api/rooms/{roomID}/members/{userID}` lets game masters update any member and players set only their own `sheet_id`; `null` clears it. Member sheets and player tokens must use the room's rule book, so cross-book choices return HTTP 400 and cross-book tokens HTTP 403. Room members may read and create characters with the room's rule book even when it is private. Migration `006_room_rule_book.sql` assigns the built-in D&D book to existing rooms.

Game masters can also invite players by username from the **Invite players** card in the room sidebar. Searching starts at two letters and runs at most every 300 ms while typing; results match anywhere in the username, prefix matches first, and leave out current members, players without a finished profile, and anyone blocked either way. Invited players answer from the bell in the header: **Join room** joins without the invite code or password (one matching character is chosen, none opens the character creator), **Decline** drops the invitation. Pending invitations are listed under **Waiting for an answer**, where they can be withdrawn. Joining a room by any route spends a pending invitation to it, and the table's member list updates live.

Invitation API: `GET /api/rooms/{roomID}/invite-candidates?q=` returns up to 8 `{id, username, pronouns, invited}` (shorter queries return `[]`). `GET /api/rooms/{roomID}/invitations` lists pending `{id, room_id, created_at, invitee}`; `POST` there with `{username}` (exact) invites, returning `404 not_found` for unknown or blocked users, `409 already_member` or `409 invitation_exists`. These three are for game masters only. `POST /api/room-invitations/{id}/accept` (the invitee) answers like `POST /api/rooms/join`; `DELETE /api/room-invitations/{id}` declines (the invitee) or withdraws (a game master of the room). The room websocket sends `member.joined` with `{room_id, user_id}` whenever someone joins.

Notifications: the bell counts incoming friend requests and room invitations and lets you answer them in place; new ones also show a toast. `GET /api/notifications` returns `{friend_requests, room_invitations}`. `GET /api/notifications/ws` is a per-user websocket that pushes `{type: "notification", body: {kind, actor?, room?}}`, with `kind` one of `friend.requested`, `friend.accepted`, `friend.changed`, `room_invitation.created`, `room_invitation.accepted` and `room_invitation.removed`; clients reload `GET /api/notifications` on each one. Notifications cross backend instances over Redis (`user:{id}:notifications`). The frontend reconnects with backoff (1 s up to 30 s) and reloads after every reconnect and whenever the tab becomes visible, so nothing missed while offline stays stale. The friends page updates live too.

Room map selection (game masters only) and token/character-sheet controls sit in a sticky left sidebar beside the tabletop, with independent scrolling on shorter screens. Below 768px, the “Map & tokens” / “Character & tokens” button opens a viewport-bounded left panel; Close tools or Escape dismisses it and returns focus to the button. Members and chat sit to the right on wide screens and below the canvas on narrower screens. The room layout uses responsive Tailwind utilities.

Table talk uses a compact Tailwind chat panel with distinct private-message and dice-roll styling. The message composer is a single-line text input; Enter sends, and IME composition does not trigger sending. Empty submissions are ignored and failed sends preserve the draft. The feed opens at the latest message and follows new ones while you are at the bottom; if you scrolled up to read, it stays put (your own messages always bring you back down). Each message shows the time it was sent (with the day when it wasn't today); hover it for the full date. A message can carry a dice roll from the **Dice roll** box: the text stays the message and the roll shows as a card under it. A dice roll arrives once, as a single `roll.result` event.

Private messages: game masters can open the audience selector and pick any players; players can pick the room's game masters to whisper them a message or a hidden roll. Only the sender, the chosen recipients and the room's game masters see a private message, live and in history. The selector opens over the feed, so the panel and sidebar keep their size. The websocket action is `chat.send` with `{text, rollExpression?, recipientUserIds?}`; a player naming anyone but a game master gets a `forbidden` error, and recipients must be members of the room.

Chat history: the room state's `chatHistory` holds the newest 200 messages you may see, oldest first, and `chatHasEarlier` says whether older ones exist. **Load earlier messages** at the top of the feed pages back through `GET /api/rooms/{roomID}/chat?before=<message id>&limit=<1-200>` (default 100), which answers `{messages, hasEarlier}` with the same private-message rules. Messages already in the feed stay when the room reloads. Migration `022_chat_roll_bodies.sql` clears old roll messages whose text had been replaced by the roll's raw JSON, so they show only the roll card.

Presence: the **At the table** list shows a green dot next to everyone who has the room open (a hollow ring when they don't). Each room socket is kept in the Redis sorted set `room:{id}:presence`, renewed every 20 s and dropped 60 s after its backend stops renewing it, so presence works across backend instances. Whenever a socket opens or closes the room websocket sends `presence.changed` with `{room_id, online_user_ids, user_id?, online?}`; a user with two tabs open stays online until both close.

At a room tabletop, game masters can left-drag every token and structure, then hide or reveal the selected object. A dragged token follows the pointer exactly and is dropped where it is, to the hundredth of a meter. Hold Shift while dragging to snap it to the grid, so its footprint covers whole cells: the token jumps from cell to cell as you drag, everyone at the table sees it snapped, and it lands on that cell. Pressing or releasing Shift mid-drag switches immediately. Movement-blocking structures stop a dragged token instead of letting it jump through: walking into a wall leaves the token resting next to it (a radius off), and the rest of the motion slides it along the wall, so walking around a wall's end works. The token is wherever the drag left it: releasing, Escape, a cancelled pointer or focus loss all drop it there, and nothing marks where it started. Dragging across empty space draws a selection rectangle and selects the tokens inside it that you may move; dragging one of the selected tokens moves the whole group (`tokens.move` with `{moves:[{tokenId, to, path}]}`, all checked before any is written, broadcast as one `token.moved` with `{token_ids}`; single moves broadcast the same shape). `path` is the way the token walked around movement-blocking structures; the server checks blocking along the stored position, then `path`, then `to`, and single moves (`token.move` with `{tokenId, to, path}`) work the same way. Game masters move a structure by dragging it; the selected structure shows a dashed frame with a round rotation handle above it, and dragging that handle rotates the structure around its frame center (Shift snaps to 15° increments). Escape cancels a structure drag. Both players and game masters measure by holding the right mouse button and dragging anywhere on the canvas; a right click without dragging does nothing. The ruler disappears immediately on release, including outside the canvas, or on cancellation or focus loss; delayed distance responses do not bring it back. Structure geometry updates optimistically, so the object remains at its transformed position while the server confirms and broadcasts it. The visibility controls reserve their layout before an object is selected, so beginning an interaction does not move the map. Hidden enemies and structures remain visible to the game master with muted styling, are omitted from player state, and do not block movement, attacks, or vision. Players can drag their own tokens and any token the game master lets them move. Structure transformations and visibility are stored per attached room map, leaving the reusable source map unchanged. Room errors (rejected moves, failed saves, lost connection) appear as toasts in the lower right.

Everyone else at the table sees a token drag live. While dragging, the client streams `token.drag` with `{moves:[{tokenId, to}]}` at most every 50 ms; nothing is stored and movement blocking is not checked until the drop. The server relays it as `token.dragging` with `{room_id, moves:[{token_id, x, y}]}`, never back to the dragger. Each move goes to game masters and only to players who could see the token at that position under the room-state fog rule, so hidden tokens never reach players. A drag that ends on the starting spot, a rejected move or a disconnect sends `token.drag.ended` with `{room_id, conn_id, token_ids}` (the client can also send `token.drag.end` with `{}`), and the previews return to the stored position; a successful drop shows the landing position at once and is replaced by `token.moved`.

The room `structure.move` websocket action accepts translation and rotation, with tolerance for the canvas's hundredth-meter coordinate rounding. The server rejects resizing, deformation, and reflection; accepted geometry is persisted in the room-map override and broadcast to the room. Backend changes require restarting the Go server, not just refreshing the frontend.

Game masters can also place and remove structures during play. Use **Place structure** in the room sidebar: pick a type and what it blocks, then click the map to place it. Placement stays active until you press **Stop placing** or Escape. To remove a structure, select it and choose **Remove structure**, then confirm. These changes apply only to the current room map and are visible to players immediately. The websocket actions are `structure.create` (`{kind, geometry, blocks_vision, blocks_movement, blocks_attacks}`) and `structure.remove` (`{structureId}`); they broadcast `structure.created` and `structure.removed`. Placed structures are stored as `map_structures` rows with `room_map_id` set, and the map editor and `GET /api/maps/{mapID}` never show them. Removing a structure from the saved map only marks it `is_removed` in that room's override, so the saved map and other rooms keep it. Run migration `007_room_structures.sql` before deploying.

Token controls:

- **Fog of war:** each player sees a full circle around each of their tokens, cut by vision-blocking structures. The radius is per token (`vision_range_m`, default 12 m). Game masters see the whole map. The room state's `visibility.visionAreas` lists `{tokenId, origin, polygon}` per token; while one of those tokens is dragged (by anyone) or has just been dropped, the client recasts its area at the token's current position, so the fog moves with it. That preview is clipped only by structures the player already knows about; the server's recast replaces it once the move is stored.
- **One character per map:** a player can place one token on the active map; a second `POST /api/rooms/{roomID}/tokens` returns `409 token_limit`. Remove the token to bring a different character.
- **Removing:** the token's owner or the game master selects it and chooses **Remove token**, then confirms (websocket `token.remove` with `{tokenId}`, broadcast as `token.removed`).
- **Token settings:** selecting a single token opens a settings card in the sidebar. Game masters set current/max/temporary HP, armor class, death saves (successes and failures 0–3 plus stable; sheet-backed tokens only, three failures mean dead and lowering them brings the character back), damage resistances, immunities and vulnerabilities, the vision radius and which other players may also move the token. The form follows the server while you look at it and **Save changes** sends only the fields you edited, so damage dealt while the card is open is never undone. The owner and the game master can upload an image that is drawn inside the token. These save through `PATCH /api/rooms/{roomID}/tokens/{tokenID}` with any of `{hit_points, max_hit_points, temporary_hit_points, armor_class, death_save_successes, death_save_failures, stable, resistances, immunities, vulnerabilities, vision_range_m, mover_user_ids, image_asset_id, conditions}` (`image_asset_id: null` clears it; the image must be one the caller uploaded).
- **Quick damage and healing:** the game master types an amount in the settings card and presses **Damage** or **Heal** (websocket `token.health` with `{tokenId, damage}` or `{tokenId, heal}`, 1–1000000). It follows the action rules: temporary HP absorb damage first, damage at 0 HP is a failed death save, healing stops at max HP and the dead can't be healed. The table gets `token.updated`.
- **Conditions:** the game master, and the owner for their own token, pick any 5e condition (blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious) or concentrating, or type their own (at most 12, up to 32 characters each). They are stored in `room_tokens.conditions` (migration `017_token_conditions.sql`), saved with `PATCH … {conditions}`, sent to everyone as the token's `conditions`, and drawn as small badges beside the token.
- **Health:** HP and defenses on a sheet-backed token are written to the sheet; tokens without a sheet keep them in their attributes. The game master, the token owner and the sheet owner see the HP values, temporary HP, defenses, death saves and a health bar under the token; other players don't receive them. Everyone receives the token's `status` (`down` at 0 HP, `stable`, or `dead`), which greys the token out with a **Down**, **Stable** or **Dead** tag (dead tokens are also crossed out), but never its numbers.
- **Your character:** players get a **Your character** card in the sidebar with HP, temporary HP, armor class, death saves, conditions and limited uses and items left. Game masters get a **Token status** card for the selected token.
- **Long rest:** **Long rest** in the settings card (one token) or **Long rest for the party** in the Token status card (every player character on the map) restores HP to max, clears temporary HP and death saves, and refills the `uses` of every limited action; items are not restocked and the dead don't rest. Sheet-backed characters are written to the sheet. Websocket `token.rest` with `{tokenIds}` or `{party: true}`, game masters only; the table gets a chat note and `token.updated`.
- **Look:** tokens without an image are coloured by side, as the viewer sees them in the `side` field: green for your own, purple for other players' characters, peach for tokens only the game master controls (monsters and NPCs); image tokens get a ring in that colour. Names sit centred below the token on a dark pill, and the selected token gets an outline ring. Action results float above the token for 3 seconds.
- **Movers:** extra movers may only move the token. Vision, actions and removal stay with the owner and the game master.

Rooms don't need a map prepared in advance. If no map is active, the first structure a game master places creates a blank 30 × 30 m map named "<room name> map", makes it active, and places the structure on it. That is the board the canvas already draws when no map is set. **Start a blank map** in the room sidebar creates an empty map with an optional name and size (`POST /api/rooms/{roomID}/maps/new` with `{name?, width_m?, height_m?, grid_size_m?}`; width and height must be above 0 and at most 1000 m). Both kinds of map are saved in the game master's map library, so they can be switched back to, edited, or deleted later. Whenever the active map changes, including switches made with **Set active map**, the room receives a `map.activated` event and every client reloads.

Tokens carry attacks, spells and abilities (`actions`), and items. A sheet-backed token stores them in the sheet's `data` and only the sheet owner can edit them; a token without a sheet stores them in `room_tokens.attributes` and only the game master can edit them. **Edit actions** saves all three lists at once through `PATCH /api/rooms/{roomID}/tokens/{tokenID}/actions` with `{attacks, actions, items}`. An action has a `kind`: `attack` (an attack roll against armor class), `save` (each target rolls a saving throw against `8 + ability modifier + proficiency (if proficient) + bonus`, with `half_on_save`), or `heal`. It also has a range, an optional `area_radius_m` (0 targets one token), dice, an optional damage type, and optional limited `uses: {max, remaining}`. Items are actions with a `quantity` instead of uses; the last one is removed when used.

Owners can also edit a character's lists outside a room: **Attacks & spells** on a sheet card in **Sheets** sends `PATCH /api/sheets/{sheetID}/actions` with the same `{attacks, actions, items}` body (all three required), returns the updated sheet, and refreshes every room token that uses the sheet. Other users get 404. `POST /api/sheets` and `PATCH /api/sheets/{sheetID}` validate any `attacks`, `actions` and `items` in `data` the same way and reject bad lists with `400 invalid_actions`.

Right-clicking a token you control without dragging (players: their own tokens; game masters: every token) opens its action wheel: **Attacks**, **Spells & abilities**, **Items**, **Checks** (any ability check, saving throw or skill check, with no DC), **Death save** while a sheet-backed character is dying, and **Edit actions**. Pick an entry, then click a highlighted target (heals may target their own token) or the point where an area lands; a confirm card shows the dice, and **Roll** sends it. For attack rolls, checks and death saves the confirm card also offers **Disadvantage / Normal / Advantage** and a one-off **Bonus** (−20 to +20, for situational modifiers). Saves forced on targets and heals have no such choice. The websocket actions are:

- `action.resolve` with `{sourceTokenId, source: "attack"|"action"|"item", actionId, targetTokenId?, point?, mode?, bonus?}`. Only attack-roll entries accept a non-normal `mode` or a `bonus`; others answer with an `invalid_roll` error, as does an unknown mode or a bonus outside −20…20.
- `check.quick` with `{tokenId, kind: "ability"|"save"|"skill", key, mode?, bonus?}`.
- `death.save` with `{tokenId, mode?, bonus?}`.

`mode` is `"normal"` (the default), `"advantage"` (roll `2d20kh1`: two d20s, keep the higher) or `"disadvantage"` (`2d20kl1`, keep the lower); `bonus` is added to the total. The chat line names the choice, e.g. "Hero attacks Goblin with Sword (advantage, +2 bonus)", and the dice line shows both d20s with the dropped one struck through.

The server checks ownership, center-to-center range, and attack-blocking structures (unless `pass_rules.attacks` is set). An area hits every token within its radius of the point that the point has a clear line to; hidden tokens are only hit by the game master's areas and are left out of the chat result. Resolution follows D&D 5e on the built-in keys, and hit points change at once:

- **Attack rolls:** `1d20 + to hit` (or `2d20kh1`/`2d20kl1` with advantage/disadvantage, plus any one-off bonus) against `armor_class` (10 when unset). Natural results use the kept die: a natural 20 always hits and doubles the damage dice; a natural 1 always misses.
- **Damage:** `temporary_hit_points` absorb it first, then `hit_points` drop, never below 0. Immunity (`immunities`) prevents it, resistance (`resistances`) halves it rounding down, and vulnerability (`vulnerabilities`) doubles it.
- **Healing:** raises `hit_points` up to `max_hit_points`. It does nothing to the dead, and brings a dying character back with its death saves cleared.
- **Down and dying:** a token at 0 of a positive `max_hit_points` cannot act. A sheet-backed character then makes death saves (`death_save_successes`, `death_save_failures`, `stable`, `dead` on the sheet): a total of 10 or more succeeds and three successes stabilize, a natural 20 brings it back with 1 HP, a natural 1 counts as two failures, and three failures kill. Damage while down is one failure, two on a critical hit. Tokens without a sheet just stay down.

Each result is one `roll.result` chat roll whose `roll.action` holds `{name, kind, source, source_token_id, dc?, save_ability?, damage_type?, effect?, targets: [{token_id, name, roll?, result, damage?, healing?, defense?, down?, dead?}], uses_left?, quantity_left?}`; it never includes a target's armor class or health. Clients float each target's result above its token and reload the room state. Attack, action and item lists for other players' and NPC tokens are never sent to players.

Freeform dice (the chat's **Dice roll** box) and every dice field use the same grammar: terms `NdM` (`d8` means `1d8`), whole numbers, and keep terms `NdMkhK` / `NdMklK` (roll N, keep the K highest or lowest, e.g. `4d6kh3`), joined by `+` and `-`. A term rolls at most 100 dice of at most 1000 sides, and K must be between 1 and N. A roll's `dice` entries are `{count, sides, values}`; keep terms add `keep: "kh"|"kl"` and `kept: [bool…]`, one flag per value, and only kept dice count toward `total`.

Game masters run fights from the turn-order strip above the map:

- **Start combat** lists the tokens on the active map, with every visible token pre-checked; **Roll initiative** rolls `1d20 + initiative` for each on the server (the sheet's or stat block's `initiative` when it is a non-zero number, otherwise the Dexterity modifier). Ties go to the higher Dexterity score, then at random. Chat announces the order and whose turn it is.
- **The strip** shows the round and each combatant with their initiative; the current turn is highlighted. Players never see hidden tokens in it, nor who is acting while a hidden token has the turn ("Waiting for the game master"); its turns are not named in chat.
- **Next turn** (game master) and **End my turn** (the player of the current combatant: its sheet's owner, else the token's owner) pass the turn on; after the last combatant the order wraps and a new round starts. Each turn change posts "Round N: Name's turn." in chat. When one of a player's characters is up, they get a "Your turn" toast and the strip is highlighted.
- **Arrange the order:** the game master can move combatants earlier or later (the turn stays with whoever has it), remove them (removing the current combatant passes the turn), **Add** tokens mid-fight (they roll initiative and go after everyone who beats or ties them) and **End combat**.
- **Not enforced:** anyone may still move and act at any time; the order only makes whose turn it is clear.
- **Websocket actions** (all but `combat.next` are game master only): `combat.start` with `{tokenIds}`, `combat.next` with `{combatantId}` (the combatant whose turn is ending; a stale one is refused with `stale_turn`), `combat.add` with `{tokenIds}`, `combat.remove` with `{combatantId}`, `combat.move` with `{combatantId, toIndex}`, and `combat.end` with `{}`. Every change sends `combat.changed`, and clients reload the room state.
- **Storage:** the room state's `combat` is `null` or `{round, current_combatant_id, combatants: [{id, token_id, name, initiative, player_user_id, is_hidden}]}` in turn order. Fights are stored in `room_combats` and `room_combatants` (migration `016_room_combat.sql`), so reloads keep them. A fight belongs to the map it started on: switching maps hides it until that map is active again, and starting a fight on another map replaces it. Deleting a token removes it from the order.

Rule books carry monsters: stat blocks with `{id, name, description, size_m, stats}`, where `stats` uses the book's attribute keys plus optional `attacks`, `actions` and `items` lists. Add them in the rule book creator's **Monsters** section, either starting blank or by extending a book, which copies its monsters. They are sent and validated as `monsters` on `POST`/`PATCH /api/rule-books`; a `PATCH` without `monsters` keeps the stored list.

- **Placing:** game masters pick a **Monster** in the room's **Add a table token** form, or send `POST /api/rooms/{roomID}/tokens` with `{monster_id, name?}`. `GET /api/rooms/{roomID}/monsters` lists the room rule book's monsters, for game masters only.
- **Each token is its own copy:** the token gets a copy of the stats in its attributes and uses the monster's size. Later rule book edits don't change monsters already placed.
- **Names:** without a name, repeats are numbered ("Goblin", "Goblin 2", …).
- **Actions:** placed monsters act through the normal action wheel, and game masters can edit them with **Edit actions**.
- **Hidden from players:** players never receive another token's attributes, so monster stat blocks stay with the game master.

Rule books also carry a **compendium**: `{attacks, actions, items}` in exactly the shapes a sheet stores, with up to 300 entries per list. Edit it in the rule book creator's **Compendium** section; it is sent and validated as `compendium` on `POST`/`PATCH /api/rule-books` (`400 invalid_compendium`), and a `PATCH` without it keeps the stored compendium. A class can name compendium ids as `starting_equipment: {attacks?, actions?, items?}`; the ids must exist in the book's compendium (otherwise `400 invalid_rules`, including when a compendium `PATCH` removes an entry a class still names), and classes cannot put `attacks`, `actions` or `items` in `defaults`.

- **Character creation:** when the chosen book has a compendium, the **Equipment & spells** step lists its entries. The class's starting equipment is pre-checked, other entries can be ticked, and **Customize or add your own** opens the list editor (with **Add from compendium**) for edits and custom entries. The picks are sent in the new sheet's `data`.
- **Not enforced:** starting equipment only pre-fills the form; players can uncheck it, and the server never applies kits.

Game masters can prompt checks with **Prompt a check** in the room sidebar. Optionally name it as an encounter (for example "Goblin ambush"). Then pick the check, a DC from 1 to 100, the players who roll (only members with a character assigned at this table can be chosen), and whether results are public or private.

- **Rolling:** each targeted player gets a **Roll** button in the **Checks** panel next to chat. Above it, **Disadvantage / Normal / Advantage** and a one-off **Bonus** apply to the next roll on that check (also when a game master rolls for a player). The server rolls `1d20 + modifier` (`2d20kh1`/`2d20kl1` with advantage/disadvantage, plus the bonus) from the player's currently assigned character, and the result succeeds when the total meets or beats the DC; the chat line names the choice, e.g. "Shadow: Stealth check (DC 13, advantage), success". Game masters can **Roll for them** on any pending target, and can **Close check** to stop further rolls (pending players show "Did not roll"). A check closes by itself once everyone has rolled.
- **Modifiers:**
  - Ability check: ability modifier.
  - Saving throw: ability modifier, plus `proficiency_bonus` when `saving_throw_proficiencies.<ability>` is true.
  - Skill check: modifier of the skill's 5e ability, plus `proficiency_bonus` when `skill_proficiencies.<skill>` is true.
  - Other attribute: any top-level numeric sheet key (`[a-z][a-z0-9_]*`), added as-is. Use this for rule books other than the built-in D&D book.
  
  Missing values count as 0. Natural 1s and 20s get no special treatment, matching 5e ability checks and saves.
- **Visibility:**
  - Public: the whole table sees the prompt, every result, and every outcome in chat.
  - Private: only the targets see the prompt, and its chat announcement doesn't name the other targets. Each target sees only their own roll, in the panel and in chat. Game masters see everything.
- **Websocket actions:**
  - `check.prompt` with `{title?, kind: "ability"|"save"|"skill"|"attribute", key, dc, targetUserIds, isPrivate}`.
  - `check.roll` with `{checkId, userId?, mode?, bonus?}`; `userId` is for game masters only, and `mode`/`bonus` work as for `check.quick`.
  - `check.close` with `{checkId}`.
- **Events and storage:**
  - Prompts post a chat announcement.
  - Results post a `roll.result` chat roll whose `roll.check` holds `{check_id, title, label, dc, success, user_id, character_name}`.
  - Every change sends `check.changed`, and clients reload the room state.
  - The state's `checks` lists open checks first, then recent closed ones, filtered per viewer. Checks are stored in `room_checks` and `room_check_targets` (migration `008_room_checks.sql`).

Frontend checks:

```bash
cd frontend
npm run build
npm test -- --run
```

### Creating and extending rule books

The rule book creator opens in **Inputs** mode. Add named attributes with number, text, yes/no, group, list, or null defaults. Groups and lists expand to let you edit their contents, and attributes can be removed before saving. Names must be unique within each group.

**JSON** mode remains available for direct creation and editing. Switching modes carries the same values across, including nested groups, lists, zero, false, and null. Invalid JSON, non-object roots, duplicate input names, and invalid numbers show errors without discarding the draft.

Choose **Start from** or **Extend this rule book** in the library to copy an existing book, including the built-in D&D defaults. Add, change, or remove inputs, give the extension a name, then create it. Extensions are independent snapshots, not linked inheritance: the source stays unchanged and future source changes do not propagate. Replacing an edited draft asks for confirmation. Newly created books are immediately available for character creation; existing characters are not changed.

**Character creation rules** adds optional classes, class-granted values, choice groups (for example, choose two class skills), and point allocation. Define the affected attribute names, minimum/maximum scores, cumulative cost for each score, total budget, and an optional separate bonus budget/per-attribute cap. Classes and rule settings have their own **Rule inputs / Rules JSON** modes and are copied when extending a book. A book with no classes and point allocation disabled stays free-form.

### Creating characters

Character creation opens in **Inputs** mode with the selected rule book's defaults already filled in. Edit labeled number and text fields, toggle yes/no values, and expand groups for skills, proficiencies, or other nested attributes. Lists support adding and removing typed items; **Add a custom attribute** adds character-specific fields without changing the rule book. Null defaults can be left unset or assigned a typed value.

If the book defines classes, choose a class and complete its choice groups. Class-granted values are applied automatically. Point allocation starts each configured attribute at its minimum; each score and bonus has − / + buttons, and **+** turns off once the next step would exceed the budget, the maximum or the bonus cap. The cards show points spent, remaining points, and final scores. Bonus points use a separate rule-defined allowance; unspent base or bonus points are allowed. Changing class confirms before resetting other values and choices, while preserving the name and point allocation. A validation error appears at the top of the group it belongs to (name, rule book, class, a choice group, point allocation or character values) and as a toast; a successful creation shows a success toast.

**JSON** mode edits the same character data, but class-granted fields, choices, and point-bought scores must match the creation controls. Both frontend and backend reject attempts to override governed fields. Other partial JSON overrides keep omitted top-level defaults, while nested objects replace the whole default group. Invalid input and failed saves keep the draft intact. Changing rule books asks before replacing edited values and keeps the name. Successful creation resets the form for the next character.

Set hit points, proficiencies, and other character-specific values before play; derived stats are not calculated automatically. Creating a character does not modify its rule book or other characters.

Attributes, class values, monster stats and character data keep the order they were written in. Postgres `jsonb` stores object keys sorted, so rule books and sheets also store a `key_order` (`{field: order}`, where an object's order is `{"keys": [...], "children": {...}}` and an array's is `{"items": [...]}`), which the server records from the JSON exactly as each POST or PATCH request wrote it. Rule book and sheet responses include it, and the web client re-applies it to `attributes`, `creation_rules`, `monsters`, `compendium` and sheet `data`. A sheet's order is its data as sent, then any rule book defaults it left out, in the book's order. The built-in D&D book uses its seed order, and characters made from it before this change take the book's order; other rule books and characters saved earlier keep the sorted order their data already had.

### Creation rule API

Rule book list/get/create/patch responses include `creation_rules`; POST/PATCH accept this object alongside `attributes`. Class IDs and names are unique; a choice group writes selected options as booleans under its `attribute`. Class defaults override ordinary defaults, then choices override their group. Point-bought attributes cannot overlap class-owned fields. For example:

```json
{
  "classes": [{
    "id": "mystic",
    "name": "Mystic",
    "defaults": { "hit_die": 6 },
    "choices": [{
      "attribute": "skills",
      "label": "Mystic training",
      "count": 1,
      "options": ["arcana", "nature"]
    }]
  }],
  "point_buy": {
    "attributes": ["focus"],
    "min": 0, "max": 3, "budget": 3,
    "costs": { "0": 0, "1": 1, "2": 2, "3": 3 },
    "bonus_budget": 1, "bonus_max": 1
  }
}
```

`POST /api/sheets` accepts `creation` separately from `data`, for example `{"class_id":"mystic","scores":{"focus":3},"bonuses":{"focus":1},"choices":{"skills":["arcana"]}}`. The result stores `data.focus: 4`, `data.class: "Mystic"`, class grants and selected choices, plus the original `creation` metadata. Governed fields may be omitted from `data`; supplied values must match. Invalid configuration, selections, overspending, or conflicting JSON return HTTP 400. The selected rule book must be accessible to the caller. A class is required only when classes are defined; allocation metadata is required only when point-buy is enabled.

Score ranges contain at most 100 integer values, with a zero-cost minimum and strictly increasing cumulative costs. Score magnitudes, costs and budgets are limited to one million; bonus caps to 100. Choice counts require that many distinct eligible options. Unknown configuration fields and unknown creation selections are rejected. Creation metadata is returned by sheet list/get/create/patch; gameplay PATCH edits do not recalculate initial budgets or change this metadata, allowing progression. Existing sheets remain unchanged.

## Built-in D&D rule book

Migration `004_default_dnd_rule_book.sql` installs **D&D 5e (2014)** as a shared, read-only rule book, available to existing and new users. It appears first in the library and character-creation selector. Built-ins have `owner_id: null`; normal users cannot rename them or grant editors. User-created rule books remain editable through their existing permissions.

The default supplies the six ability scores, level, proficiency bonus, armor class, initiative, movement in meters, hit-point tracking, inspiration, death saves, six saving-throw proficiency flags, and all 18 skill proficiency flags. Migration `005_character_creation_rules.sql` adds the 12 SRD 5.1 classes, class hit dice, saving-throw proficiencies, eligible class skill choices, and the 2014 **27-point-buy variant** (base scores 8–15; cumulative costs 0, 1, 2, 3, 4, 5, 7, 9). Point allocation supersedes the book's generic ability defaults at creation.

Migration `009_rule_book_monsters.sql` adds 12 low-level SRD 5.1 monsters to the built-in book: bandit, bugbear, giant rat, gnoll, goblin, hobgoblin, kobold, ogre, orc, skeleton, wolf and zombie. Each has its SRD ability scores, AC, average HP, speed, proficiencies and weapon attacks, with special traits summarized in the description. Expertise is not modelled: for example, the goblin's and bugbear's Stealth +6 counts as proficiency only (+4). The same migration removes the unused `npcs` table and `room_tokens.npc_id`.

Migration `014_rule_book_compendium.sql` adds the `compendium` column and seeds the built-in book's compendium with the 42 SRD 5.1 weapon attacks (thrown weapons get a separate thrown entry), 18 common spells and 5 consumables, only while that compendium is empty. Each of the 12 classes gets starting weapons from the first option of its SRD starting-equipment choices (for example, the fighter gets a longsword and a light crossbow). Modelling limits: versatile weapons use one-handed damage, every entry is marked proficient, spells use the most common caster's ability and have no uses because spell slots aren't modelled, cones and cubes become small circles, Magic Missile is left out because auto-hit isn't modelled, and holy water's fiend/undead restriction and alchemist's fire's ongoing burn are not modelled. Players can edit any entry after picking it.

Ancestry bonuses are not guessed: the built-in bonus allowance is zero. Extend the book to configure a separate allowance for your table. Class hit dice, saves, and class skill choices are applied, and class starting weapons are pre-picked; hit points, armor and other equipment, spell slots, backgrounds, ancestry traits, subclasses, multiclassing and leveling are not automated. Set character-specific values before play. Existing sheets are not rewritten.

For an existing installation, run `go run ./cmd/migrate` from `backend`, then restart the Go server before serving the updated frontend. Migration 005 adds the two JSON columns and seeds creation rules only on the built-in book when its rules are empty. Custom books and existing characters are preserved.

This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at [https://dnd.wizards.com/resources/systems-reference-document](https://dnd.wizards.com/resources/systems-reference-document). The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at [https://creativecommons.org/licenses/by/4.0/legalcode](https://creativecommons.org/licenses/by/4.0/legalcode).

Sources: [SRD 5.1 PDF](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf), [2014 class creation rules](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/classes), and [2014 ability-score point costs](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/step-by-step-characters#VariantCustomizingAbilityScores).

## Prerequisites

- Podman and `podman-compose`
- Node.js and npm
- Go 1.23+

This repository includes a local Go install at `.tools/go` if you used the setup created during implementation.

To make that Go available in every new Bash terminal:

```bash
echo 'export PATH="$HOME/Documents/projects/rollandplay/.tools/go/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

Verify:

```bash
go version
```

Expected example:

```text
go version go1.23.6 linux/amd64
```

## Production deployment

The recommended online setup is same-origin HTTPS:

```text
https://your-domain.example/          -> frontend static files
https://your-domain.example/api/*     -> Go backend
https://your-domain.example/ws/*      -> Go backend websocket path, if you add this alias
https://your-domain.example/api/.../ws -> current backend websocket route
```

The frontend uses relative `/api` requests and cookie auth, so same-origin hosting avoids CORS and cookie issues. Put a reverse proxy or platform router in front of the Go backend and route `/api/*` to it.

### Continuous deployment (GitHub Actions → VPS)

`.github/workflows/backend.yml` and `.github/workflows/frontend.yml` run tests on pull requests and on pushes to `main`. A push to `main` that touches `backend/**` or `frontend/**` also deploys that part. You can start either workflow by hand with **Run workflow**.

- **Backend:** runs `go test ./...` against Postgres 16 and Redis 7 service containers. It builds static `linux/amd64` `server` and `migrate` binaries, rsyncs them to `/opt/rollandplay/backend/releases/<sha>/`, and switches the `current` symlink. Then it restarts `rollandplay-backend`. That systemd unit runs `migrate` before every start (applied migrations are skipped). If the restart fails, or the server doesn't answer HTTP within 30 s, the deploy prints the unit journal and switches back to the previous release.
- **Frontend:** runs `npm ci`, `vitest run` and `npm run build`. The build uses no `VITE_*` variables (same-origin), rsyncs `dist/` to `/opt/rollandplay/frontend/releases/<sha>/` and switches `current`. nginx serves that folder.
- The 5 newest releases of each part are kept. To roll back by hand, point `/opt/rollandplay/<part>/current` at an older release (as `deploy`). For the backend, then run `sudo systemctl restart rollandplay-backend`.

Server layout, created by `deploy/provision.sh` (idempotent, run as root on Ubuntu 22.04):

| Path / unit | Purpose |
| --- | --- |
| `/etc/rollandplay/backend.env` | Backend environment (root-only). Generated once with a random DB password and `ROOM_PASSWORD_SALT`. **Set `SMTP_*` here**, then `systemctl restart rollandplay-backend`. |
| `rollandplay-backend.service` | Runs as the `rollandplay` user and listens on `127.0.0.1:8080` (`deploy/systemd/`). |
| nginx `rollandplay.conf` | Port 80 answers ACME challenges and redirects to HTTPS. Port 443 serves the frontend with an SPA fallback and proxies `/api/` (including websockets) to the backend (`deploy/nginx/`). |
| `/etc/letsencrypt/live/rollandplay/` | Let's Encrypt certificate from certbot (snap, webroot `/var/www/letsencrypt`). `snap.certbot.renew.timer` renews it and reloads nginx. |
| `/var/lib/rollandplay/assets` | Uploaded assets. |
| `deploy` user | CI login. The key is installed with `restrict`; sudo is limited to `systemctl restart rollandplay-backend`. |
| `metrics` user | Optional and tunnel-only (`METRICS_PUBKEY`). Its key can only forward to `127.0.0.1:9464`: no shell, no other ports. See [Metrics and dashboards](#metrics-and-dashboards). |

Provisioning or updating a server: run these from the repository root on your machine (the folder that contains `deploy/`). Replace `SERVER` with the VPS address, e.g. `143.95.169.22`. SSH asks for the root password; never put it in the command. The server doesn't need git; your local `deploy/` folder is streamed over SSH and replaces the previous copy each time. The script must run as root on the Ubuntu server, and it refuses to run anywhere else.

First run (installs the CI key and sets the public URL):

```bash
tar czf - deploy | ssh -p 22022 root@SERVER "rm -rf /root/rollandplay-deploy && mkdir /root/rollandplay-deploy && tar xzf - -C /root/rollandplay-deploy && \
  DEPLOY_PUBKEY='$(cat ~/.ssh/rollandplay/deploy_key.pub)' PUBLIC_BASE_URL='https://SERVER' /root/rollandplay-deploy/deploy/provision.sh"
```

Re-runs, after changing anything under `deploy/` except `release.sh` (CI sends that with every deploy). Re-runs reuse the installed key and the URL from `/etc/rollandplay/backend.env`. Pass `DEPLOY_PUBKEY` or `PUBLIC_BASE_URL` again only to change them (for example, when moving to a domain):

```bash
tar czf - deploy | ssh -p 22022 root@SERVER "rm -rf /root/rollandplay-deploy && mkdir /root/rollandplay-deploy && tar xzf - -C /root/rollandplay-deploy && \
  /root/rollandplay-deploy/deploy/provision.sh"
```

Repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | VPS IP or hostname |
| `DEPLOY_PORT` | SSH port (`22022`) |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | Private key matching `DEPLOY_PUBKEY` |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan -p 22022 SERVER` |

HTTPS: `PUBLIC_BASE_URL` must be `https://`. Its host gets the certificate. A bare IP gets a 6-day certificate (Let's Encrypt `shortlived` profile, renewed automatically). A domain gets a normal 90-day one. To switch from the IP to a domain, point the domain's A record at the VPS. Then re-run `provision.sh` with `PUBLIC_BASE_URL='https://your-domain'`. That reissues the certificate under the same name and updates the URLs in `backend.env`. Ports 80 and 443 must stay reachable.

### Required production services

- Postgres 16+
- Redis 7+
- Real SMTP provider
- Persistent asset storage directory mounted into the backend container/server
- HTTPS terminator/reverse proxy

Do not deploy MailHog online. MailHog is only a local development inbox.

### Backend production environment

Copy the production template and replace every placeholder:
 
```bash
cp backend/.env.production.example backend/.env
```

The backend loads `backend/.env` automatically when run from the `backend` directory. Real environment variables still override values from the file.

Set these variables for the backend process:

```bash
HTTP_ADDR=':8080'
METRICS_ADDR='127.0.0.1:9464'   # Prometheus /metrics; keep it on loopback
PUBLIC_BASE_URL='https://your-domain.example'
API_BASE_URL='https://your-domain.example'
DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require'
REDIS_ADDR='HOST:6379'
REDIS_PASSWORD='REDIS_PASSWORD_IF_ANY'
SESSION_COOKIE_NAME='rollandplay_session'
SESSION_TTL_HOURS='720'          # sign-in lifetime since the last refresh
ACCESS_TOKEN_TTL_MINUTES='15'    # access cookie lifetime; the frontend refreshes before it ends
MAGIC_LINK_TTL_MINUTES='15'
SMTP_ADDR='smtp.provider.example:587'
SMTP_FROM='Rollandplay <no-reply@your-domain.example>'
SMTP_USERNAME='SMTP_USER'
SMTP_PASSWORD='SMTP_PASSWORD_OR_APP_PASSWORD'
ASSET_STORAGE_DRIVER='disk'      # disk or s3
ASSET_STORAGE_DIR='/var/lib/rollandplay/assets'
# Required when ASSET_STORAGE_DRIVER='s3' (S3 or Cloudflare R2, private bucket):
# S3_ENDPOINT='ACCOUNT_ID.r2.cloudflarestorage.com'   # host only
# S3_REGION='auto'
# S3_BUCKET='rollandplay-assets'
# S3_ACCESS_KEY_ID='...'
# S3_SECRET_ACCESS_KEY='...'
# S3_PRESIGN_TTL_MINUTES='15'
ROOM_PASSWORD_SALT='generate-a-long-random-secret'
LOG_LEVEL='info'
LOG_FORMAT='json'
```

`ROOM_PASSWORD_SALT` must not be empty outside localhost. `LOG_LEVEL` accepts zap levels such as `debug`, `info`, `warn`, and `error`; `LOG_FORMAT` accepts `json` or `console`.

Uploaded assets are served by `GET /api/assets/{assetID}` to signed-in users. Disk assets are streamed directly; S3 assets get a `302` redirect to a short-lived presigned URL. Either driver serves assets saved by the other, so switching to S3 is a config change: set the `S3_*` variables and `ASSET_STORAGE_DRIVER='s3'`, restart the backend, then copy the existing disk files with `cd backend && go run ./cmd/migrate-assets`. It uploads every asset not yet on S3, updates its `storage_path` to `s3://bucket/id`, keeps the local files, and can be re-run safely. The backend refuses to start with `ASSET_STORAGE_DRIVER='s3'` and missing `S3_*` settings.

Run migrations before starting or rolling out a new backend:

```bash
cd backend
go run ./cmd/migrate
```

Start the backend:

```bash
cd backend
go run ./cmd/server
```

### Frontend production build

Copy the frontend production template:

```bash
cp frontend/.env.production.example frontend/.env
```

For same-origin production, leave `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` blank. If the frontend and backend use different hosts, set them to the backend HTTP and websocket origins.

Build static files:

```bash
cd frontend
npm install
npm run build
```

Serve `frontend/dist` from your web server or hosting provider.

### Reverse proxy requirements

Forward these to the backend:

- `/api/*`
- websocket upgrades for `/api/rooms/{roomID}/ws` and `/api/notifications/ws`

The proxy must preserve:

- `Host`
- `X-Forwarded-Proto`
- `Upgrade`
- `Connection`

Sign-in uses httpOnly cookies: a short-lived access token (`SameSite=Lax`) and a refresh token limited to `/api/auth` (`SameSite=Strict`). Both are `Secure` when `PUBLIC_BASE_URL` is `https://`. Use HTTPS in production.

## How to run locally

Run commands from the repository root unless noted.

Local env files are already included for development:

- `backend/.env`
- `frontend/.env`

If either file is missing, recreate it from the templates:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### 1. Start local services

```bash
podman-compose up -d postgres redis mailhog
```

Services:

- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- MailHog SMTP: `localhost:1025`
- MailHog inbox: `http://localhost:8025`

### 2. Apply database migrations

The repository includes `backend/.env` with local development values. The backend migration tool loads it automatically when run from `backend`.

```bash
cd backend
go run ./cmd/migrate
```

Expected:

```text
migrations applied
```

### 3. Start the backend

In the same `backend` terminal:

```bash
go run ./cmd/server
```

Expected:

```text
rollandplay backend listening :8080
```

Keep this terminal open.

### 4. Start the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Expected:

```text
Local: http://127.0.0.1:5173/
```

Keep this terminal open.

### 5. Sign in with a magic link

Open:

```text
http://127.0.0.1:5173/login
```

Enter an email, for example:

```text
dm@example.com
```

Then open MailHog:

```text
http://localhost:8025
```

Open the email and click/copy the sign-in link. After consuming the link, the site routes to the protected page requested in that tab, or `/rooms` by default. Use the same frontend hostname throughout the flow (`localhost` and `127.0.0.1` have separate cookies and tab storage); configure `PUBLIC_BASE_URL` to match the origin you use.

For a second user, use another browser profile or private window and repeat with a different email, for example:

```text
player@example.com
```

## Stop local services

```bash
podman-compose down
```

To also remove local Postgres and Redis volumes:

```bash
podman-compose down -v
```

This deletes local development data.

## Metrics and dashboards

The backend exports OpenTelemetry metrics in Prometheus format on `METRICS_ADDR` (default `127.0.0.1:9464`, path `/metrics`). That listener is separate from the API, binds to loopback, and is never proxied by nginx.

| Metric | Meaning |
| --- | --- |
| `http_server_request_duration_seconds` (histogram) | Requests by `http_request_method`, `http_response_status_code`, and `http_route`. The route is the ServeMux pattern, e.g. `/api/rooms/{roomID}`, and is absent for unmatched paths. No host, client, or raw-path labels. |
| `http_server_request_body_size_bytes`, `http_server_response_body_size_bytes` | Body sizes, with the same labels. |
| `rollandplay_websocket_connections` | Websocket connections open on the instance. |
| `rollandplay_email_sends_total{result="sent"\|"failed"}` | Magic-link delivery attempts. |
| `go_*`, `process_*` | Go runtime and process (memory, CPU, goroutines, GC). |

Prometheus and Grafana run on your machine, in `compose.yaml`, with host networking and loopback-only ports:

```bash
podman-compose up -d prometheus grafana
```

- Grafana: `http://127.0.0.1:3030` (no login). The provisioned **Rollandplay backend** dashboard has an **Environment** selector.
- Prometheus: `http://127.0.0.1:9090`. It scrapes the local backend (`env="local"`) and production through a tunnel (`env="production"`). Config: `observability/`.

To see production, open the tunnel and leave it running:

```bash
ssh -N -L 19464:127.0.0.1:9464 -p 22022 metrics@143.95.169.22
```

Prometheus only collects production data while the tunnel is open. Gaps are expected, and counters restart on every deploy (PromQL `rate`/`increase` handle resets). Nothing is stored on the VPS.

The tunnel key is set by re-running provisioning with your public key. See [Continuous deployment](#continuous-deployment-github-actions--vps) for the full command:

```bash
tar czf - deploy | ssh -p 22022 root@SERVER "rm -rf /root/rollandplay-deploy && mkdir /root/rollandplay-deploy && tar xzf - -C /root/rollandplay-deploy && \
  METRICS_PUBKEY='$(cat ~/.ssh/id_ed25519.pub)' /root/rollandplay-deploy/deploy/provision.sh"
```

## Useful URLs

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://localhost:8080`
- MailHog inbox: `http://localhost:8025`
- Grafana: `http://127.0.0.1:3030`
- Prometheus: `http://127.0.0.1:9090`
- Backend metrics: `http://127.0.0.1:9464/metrics`
