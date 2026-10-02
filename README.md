# Rollandplay

Rollandplay is a TTRPG hosting platform with a Go backend, Postgres, Redis, SMTP magic-link email, websocket room updates, and a React/Vite frontend.

## Frontend experience and access

The public `/` page introduces Rollandplay with responsive editorial layouts, bundled Outfit typography, and GSAP scroll animation. Images are served by Picsum; reduced-motion preferences disable the animated entrances, marquee, image transforms, and pinned layout.

The shared frontend palette uses pink `#ffa9a9` for alerts and headline highlights, green `#d9ffb5` for success and terrain, peach `#ffb887` for warm accents and doors, purple `#be8cff` for primary actions and walls, and lavender `#ebc7ff` for secondary accents and windows. Map cover uses pink. Dark neutral surfaces and contrasting text keep pastel controls readable; theme variables live in `frontend/src/index.css`.

Rooms, friends, rule books, character sheets, maps, and map editors are available only after `/api/me` confirms a session. While that check is pending or fails, neither feature navigation nor feature screens mount. Connection failures offer a retry; protected API responses with status `401` remove the workspace and return to sign-in. Backend authorization remains the security boundary.

Sign-in uses an email magic link. A protected URL opened before sign-in is remembered in the current tab and restored afterward; otherwise sign-in opens `/rooms`. Sign out revokes the session and returns to the public landing page. On smaller screens, authenticated navigation is available through the menu button.

Workspace forms expose loading, empty, and error states. JSON editors report malformed input without discarding it. The map editor includes a scrollable/zoomable live canvas: right-click a draft or saved structure to choose Move or Rotate from the radial wheel. The selected mode stays active across drags, selection changes, saves, and cancellations until another mode is chosen; the wheel highlights the active mode. Move is the initial mode. Drag structures to use that mode; rotation is around the bounding-box center, with Shift snapping to 15° increments. In Move mode, square handles resize, Shift constrains movement, and clicking empty canvas space places the draft without changing its size or rotation. Escape cancels the current drag without resetting the mode. Drag empty space to pan, hold Ctrl and scroll to zoom around the pointer, and press Ctrl/Cmd+Z to undo geometry edits. The old one-shot rotation buttons, nudge controls, round rotation handles, and endpoint-rotation gesture have been removed. Zoom, scale, direct JSON geometry editing, and import/export remain available. Rooms let game masters attach an active map, and DM token placement does not require a character sheet. The tabletop canvas supports pointer interaction at responsive sizes, and game-master controls use the signed-in user identity rather than a fixed local user.

The canvas-side Brushes palette includes a Place action for the active draft, so a positioned structure can be saved without scrolling to the detailed structure form below the canvas. Map settings expose positive width and height values in meters; each change saves on blur and redraws the playable canvas boundary.

Every room plays with one rule book, chosen when the room is created (the built-in D&D book is preselected) and shown in the room list and room header. Joining is two steps: **Find room** previews the invite's room name and rule book, asks for the password only when the room has one, and lists your characters for that rule book. One matching character is chosen automatically; with several, pick one. Without a matching character, **Join and create a character** joins the room and opens the character creator locked to the room's rule book; creating the character returns you to the room with it chosen. **Enter the room without a character** skips this. Game masters skip the character step.

Inside a room, players see only their own characters for the room's rule book, both under **Your character** in the members panel and in the token form; game masters see their own and public sheets for that book. Choosing **No sheet** clears the character.

`GET /api/rooms` lists only rooms you created or joined; add `?public=true` to also include other users' public rooms. Another user's private room never appears in the list, so its invite code is not exposed. To join it you need the invite code and, if the room has one, its password.

Room API: room responses include `rule_book: {id, name}`. `POST /api/rooms` accepts `rule_book_id` (defaults to the built-in book; it must be readable by the creator). `GET /api/invites/{code}` returns `{room_id, name, rule_book, requires_password, member}`, where `member` is `null` before joining or `{is_dm, sheet_id}`. `POST /api/rooms/join` accepts an optional `sheet_id` and returns `{room_id, rule_book, is_dm, sheet_id}`; rejoining without `sheet_id` keeps the current character. `PATCH /api/rooms/{roomID}/members/{userID}` lets game masters update any member and players set only their own `sheet_id`; `null` clears it. Member sheets and player tokens must use the room's rule book, so cross-book choices return HTTP 400 and cross-book tokens HTTP 403. Room members may read and create characters with the room's rule book even when it is private. Migration `006_room_rule_book.sql` assigns the built-in D&D book to existing rooms.

Room map selection (game masters only) and token/character-sheet controls sit in a sticky left sidebar beside the tabletop, with independent scrolling on shorter screens. Below 768px, the “Map & tokens” / “Character & tokens” button opens a viewport-bounded left panel; Close tools or Escape dismisses it and returns focus to the button. Members and chat sit to the right on wide screens and below the canvas on narrower screens. The room layout uses responsive Tailwind utilities.

Table talk uses a compact Tailwind chat panel with distinct private-message and dice-roll styling. The message composer is a single-line text input; Enter sends, and IME composition does not trigger sending. Empty submissions are ignored and failed sends preserve the draft. The feed opens at the latest message and scrolls to each new message without moving the room page; typing does not reset a manually scrolled feed. Game masters can expand the audience selector to choose private recipients.

At a room tabletop, game masters can left-drag every token and structure, then hide or reveal the selected object. Right-clicking a structure without dragging opens the persistent Move/Rotate wheel for game masters on release. The chosen mode applies to subsequent left-button structure drags, including other structures, until explicitly changed. Holding Shift while rotating snaps to 15° increments; Escape cancels the current drag without changing the mode. Both players and game masters measure by holding the right mouse button and dragging anywhere on the canvas, independently of the structure mode. The ruler disappears immediately on release, including outside the canvas, or on cancellation or focus loss; delayed distance responses do not bring it back. Left-dragging empty space no longer measures. Structure geometry updates optimistically, so the object remains at its transformed position while the server confirms and broadcasts it. The visibility controls reserve their layout before an object is selected, so beginning an interaction does not move the map. Hidden enemies and structures remain visible to the game master with muted styling, are omitted from player state, and do not block movement, attacks, or vision. Players can drag only tokens backed by their own character sheets. Structure transformations and visibility are stored per attached room map, leaving the reusable source map unchanged.

The room `structure.move` websocket action accepts translation and rotation, with tolerance for the canvas's hundredth-meter coordinate rounding. The server rejects resizing, deformation, and reflection; accepted geometry is persisted in the room-map override and broadcast to the room. Backend changes require restarting the Go server, not just refreshing the frontend.

Game masters can also place and remove structures during play. Use **Place structure** in the room sidebar: pick a type and what it blocks, then click the map to place it. Placement stays active until you press **Stop placing** or Escape. To remove a structure, select it and choose **Remove structure**, then confirm. These changes apply only to the current room map and are visible to players immediately. The websocket actions are `structure.create` (`{kind, geometry, blocks_vision, blocks_movement, blocks_attacks}`) and `structure.remove` (`{structureId}`); they broadcast `structure.created` and `structure.removed`. Placed structures are stored as `map_structures` rows with `room_map_id` set, and the map editor and `GET /api/maps/{mapID}` never show them. Removing a structure from the saved map only marks it `is_removed` in that room's override, so the saved map and other rooms keep it. Run migration `007_room_structures.sql` before deploying.

Rooms don't need a map prepared in advance. If no map is active, the first structure a game master places creates a blank 30 × 30 m map named "<room name> map", makes it active, and places the structure on it. That is the board the canvas already draws when no map is set. **Start a blank map** in the room sidebar creates an empty map with an optional name and size (`POST /api/rooms/{roomID}/maps/new` with `{name?, width_m?, height_m?, grid_size_m?}`; width and height must be above 0 and at most 1000 m). Both kinds of map are saved in the game master's map library, so they can be switched back to, edited, or deleted later. Whenever the active map changes, including switches made with **Set active map**, the room receives a `map.activated` event and every client reloads.

Tokens carry attacks. A sheet-backed token stores them in the sheet's `data.attacks` and only the sheet owner can edit them; a token without a sheet stores them in `room_tokens.attributes.attacks` and only the game master can edit them (`PATCH /api/rooms/{roomID}/tokens/{tokenID}/attacks`, or **Edit attacks** in the room sidebar). Clicking a token you control without dragging (players: their own tokens; game masters: every token) opens its attack menu and draws the attack's range; picking an attack and clicking a highlighted target sends the `attack.resolve` websocket action. The server checks ownership, center-to-center range, and attack-blocking structures (unless `pass_rules.attacks` is set), then rolls D&D-style — to hit `1d20 + ability modifier + proficiency bonus (if proficient) + attack bonus`, damage `dice + ability modifier + damage bonus` — and posts one chat roll containing both. Attack lists for other players' and NPC tokens are never sent to players.

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

If the book defines classes, choose a class and complete its choice groups. Class-granted values are applied automatically. Point allocation starts each configured attribute at its minimum and shows cumulative costs, remaining points, and final scores. Bonus points use a separate rule-defined allowance; unspent base or bonus points are allowed. Changing class confirms before resetting other values and choices, while preserving the name and point allocation.

**JSON** mode edits the same character data, but class-granted fields, choices, and point-bought scores must match the creation controls. Both frontend and backend reject attempts to override governed fields. Other partial JSON overrides keep omitted top-level defaults, while nested objects replace the whole default group. Invalid input and failed saves keep the draft intact. Changing rule books asks before replacing edited values and keeps the name. Successful creation resets the form for the next character.

Set hit points, proficiencies, and other character-specific values before play; derived stats are not calculated automatically. Creating a character does not modify its rule book or other characters.

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

Ancestry bonuses are not guessed: the built-in bonus allowance is zero. Extend the book to configure a separate allowance for your table. Class hit dice, saves, and class skill choices are applied; hit points, equipment, spell choices, backgrounds, ancestry traits, subclasses, multiclassing and leveling are not automated. Set character-specific values before play. Existing sheets are not rewritten.

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
PUBLIC_BASE_URL='https://your-domain.example'
API_BASE_URL='https://your-domain.example'
DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require'
REDIS_ADDR='HOST:6379'
REDIS_PASSWORD='REDIS_PASSWORD_IF_ANY'
SESSION_COOKIE_NAME='rollandplay_session'
SESSION_TTL_HOURS='720'
MAGIC_LINK_TTL_MINUTES='15'
SMTP_ADDR='smtp.provider.example:587'
SMTP_FROM='Rollandplay <no-reply@your-domain.example>'
SMTP_USERNAME='SMTP_USER'
SMTP_PASSWORD='SMTP_PASSWORD_OR_APP_PASSWORD'
ASSET_STORAGE_DIR='/var/lib/rollandplay/assets'
ROOM_PASSWORD_SALT='generate-a-long-random-secret'
LOG_LEVEL='info'
LOG_FORMAT='json'
```

`ROOM_PASSWORD_SALT` must not be empty outside localhost. `LOG_LEVEL` accepts zap levels such as `debug`, `info`, `warn`, and `error`; `LOG_FORMAT` accepts `json` or `console`.

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
- websocket upgrades for `/api/rooms/{roomID}/ws`

The proxy must preserve:

- `Host`
- `X-Forwarded-Proto`
- `Upgrade`
- `Connection`

Cookie auth uses httpOnly `SameSite=Lax` cookies. Use HTTPS in production.

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

## Useful URLs

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://localhost:8080`
- MailHog inbox: `http://localhost:8025`
