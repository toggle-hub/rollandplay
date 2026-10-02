import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Circle, Eye, EyeSlash, MapTrifold, Trash, UsersThree } from "@phosphor-icons/react";
import { apiFetch, connectRoomSocket, patchJSON, postJSON, requestId } from "../api/client";
import type { ChatMessage, GameMap, Monster, RoomMember, ServerEnvelope, Sheet, VisibleRoomState } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { MapCanvas, type MapSelection } from "../components/MapCanvas";
import { ChatPanel } from "../components/ChatPanel";
import { CheckPromptForm } from "../components/CheckPromptForm";
import { RoomChecks } from "../components/RoomChecks";
import { PlayerName } from "../components/PlayerName";
import { TokenAttacksEditor } from "../components/TokenAttacksEditor";
import { defaultBlocksForKind, structureTypes, type StructureBlocks } from "../lib/structures";

type Point = { x: number; y: number };

export function RoomPage() {
  const { roomId } = useParams();
  const { session } = useSession();
  const user = session.status === "authenticated" ? session.user : null;
  const [state, setState] = useState<VisibleRoomState | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [ruler, setRuler] = useState<number | undefined>();
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState("");
  const [mapChoice, setMapChoice] = useState("");
  const [tokenName, setTokenName] = useState("Encounter token");
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [monsterChoice, setMonsterChoice] = useState("");
  const [mapSelection, setMapSelection] = useState<MapSelection | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [attackEditorTokenId, setAttackEditorTokenId] = useState<string | null>(null);
  const [structureKind, setStructureKind] = useState("wall");
  const [structureBlocks, setStructureBlocks] = useState<StructureBlocks>(() => defaultBlocksForKind("wall"));
  const [placingStructure, setPlacingStructure] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [blankMap, setBlankMap] = useState({ name: "", width: "30", height: "30" });
  const previousMapId = useRef("");
  const toolsToggleRef = useRef<HTMLButtonElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const myMember = members.find((member) => member.user_id === user?.id);
  const isDM = !!myMember?.is_dm;
  // Characters usable at this table: the room's rule book, and for players only their own sheets.
  const roomSheets = sheets.filter((item) => item.rule_book_id === state?.room.rule_book.id && (isDM || item.user_id === user?.id));
  const currentMapId = state ? activeMapId(state) : "";
  const movableTokenIds = useMemo(() => {
    const ids = new Set<string>();
    const tokens = isDM ? state?.visibleTokens : state?.ownTokens;
    tokens?.forEach((token) => ids.add(token.id));
    return ids;
  }, [isDM, state?.visibleTokens, state?.ownTokens]);
  const selectedToken = mapSelection?.kind === "token" ? state?.visibleTokens.find((token) => token.id === mapSelection.id) : undefined;
  const selectedStructure = mapSelection?.kind === "structure" ? state?.structures.find((structure) => structure.id === mapSelection.id) : undefined;
  const selectedMapObject = selectedToken ?? selectedStructure;
  const selectedMapObjectLabel = selectedToken?.name ?? selectedStructure?.kind;
  const attackEditorToken = state?.visibleTokens.find((token) => token.id === attackEditorTokenId && token.attacks_editable);

  async function load() {
    if (!roomId) return;
    try {
      const [nextState, nextMembers, nextSheets, nextMaps] = await Promise.all([
        apiFetch<VisibleRoomState>(`/api/rooms/${roomId}/state`),
        apiFetch<RoomMember[]>(`/api/rooms/${roomId}/members`),
        apiFetch<Sheet[]>("/api/sheets"),
        apiFetch<GameMap[]>("/api/maps"),
      ]);
      setState(nextState);
      setMembers(nextMembers ?? []);
      setSheets(nextSheets ?? []);
      setMaps(nextMaps ?? []);
      setSheet((current) => current || nextMembers?.find((member) => member.user_id === user?.id)?.sheet_id || "");
      setMapChoice((current) => current || activeMapId(nextState) || nextMaps?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this room.");
    }
  }

  useEffect(() => {
    setState(null);
    setError("");
    void load();
  }, [roomId]);

  useEffect(() => {
    setMapSelection(null);
    setAttackEditorTokenId(null);
    // Placing the first structure in a map-less room starts a map; keep the brush active through that.
    if (previousMapId.current) setPlacingStructure(false);
    previousMapId.current = currentMapId;
  }, [currentMapId]);

  useEffect(() => setConfirmRemove(false), [mapSelection]);

  useEffect(() => {
    if (!isDM || !roomId) return;
    apiFetch<Monster[]>(`/api/rooms/${roomId}/monsters`).then((items) => setMonsters(items ?? [])).catch(() => setMonsters([]));
  }, [isDM, roomId]);

  useEffect(() => {
    if (!roomId) return;
    const ws = connectRoomSocket(roomId, (event: ServerEnvelope) => {
      if ((event.type === "chat.message" || event.type === "roll.result") && isChatMessage(event.body)) {
        const message = event.body;
        setState((current) => current ? { ...current, chatHistory: [...(current.chatHistory ?? []), message] } : current);
      }
      if (event.type === "token.moved" || event.type === "token.updated" || event.type === "structure.moved" || event.type === "structure.updated" || event.type === "structure.created" || event.type === "structure.removed" || event.type === "map.activated" || event.type === "vision.update" || event.type === "check.changed" || event.type === "state.snapshot") void load();
      if (event.type === "ruler.result" && isMetersBody(event.body)) setRuler(Number(event.body.meters));
      if (event.type === "error" && isErrorBody(event.body)) {
        setError(event.body.message);
        void load();
      }
    });
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      void load();
    };
    ws.onclose = () => {
      setConnected(false);
    };
    ws.onerror = () => setError("The live connection was interrupted. Reload this room to reconnect.");
    return () => {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      wsRef.current = null;
    };
  }, [roomId]);

  function send(type: string, body: unknown) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) throw new Error("The room is not connected. Reload the page to reconnect.");
    wsRef.current.send(JSON.stringify({ type, requestId: requestId(), body }));
  }

  function sendMap(type: string, body: unknown) {
    try {
      send(type, body);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the map action.");
      return false;
    }
  }

  function toggleSelectedVisibility() {
    if (!isDM || !mapSelection || !selectedMapObject) return;
    if (mapSelection.kind === "token") {
      sendMap("token.visibility", { tokenId: mapSelection.id, isHidden: !selectedMapObject.is_hidden });
      return;
    }
    sendMap("structure.visibility", { structureId: mapSelection.id, isHidden: !selectedMapObject.is_hidden });
  }
  function moveRoomStructure(structureId: string, geometry: Point[]) {
    if (!sendMap("structure.move", { structureId, geometry })) return;
    setState((current) => current ? {
      ...current,
      structures: current.structures.map((structure) => structure.id === structureId ? { ...structure, geometry } : structure),
    } : current);
  }

  const measure = useMemo(() => throttlePoint((from: Point, to: Point) => sendMap("ruler.measure", { from, to }), 100), [roomId]);

  async function update(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this room.");
    } finally {
      setBusy(false);
    }
  }

  function addToken(e: FormEvent) {
    e.preventDefault();
    if (isDM) {
      // Monster tokens are named and numbered by the server unless the DM typed a name.
      const body = monsterChoice
        ? { monster_id: monsterChoice, name: tokenName.trim() || undefined, x_m: 2, y_m: 2 }
        : { name: tokenName.trim() || sheets.find((item) => item.id === sheet)?.name || "Token", sheet_id: sheet || undefined, x_m: 2, y_m: 2 };
      void update(() => postJSON(`/api/rooms/${roomId}/tokens`, body));
      return;
    }
    if (sheet) void update(() => postJSON(`/api/rooms/${roomId}/tokens`, { sheet_id: sheet, name: sheets.find((item) => item.id === sheet)?.name ?? "Token", x_m: 2, y_m: 2 }));
  }

  function attachMap(e: FormEvent) {
    e.preventDefault();
    if (mapChoice) void update(() => postJSON(`/api/rooms/${roomId}/maps`, { map_id: mapChoice, is_active: true }));
  }

  function startBlankMap(e: FormEvent) {
    e.preventDefault();
    const body = { name: blankMap.name.trim() || undefined, width_m: Number(blankMap.width), height_m: Number(blankMap.height) };
    void update(async () => {
      const created = await postJSON<GameMap>(`/api/rooms/${roomId}/maps/new`, body);
      setMapChoice(created.id);
      setBlankMap((current) => ({ ...current, name: "" }));
    });
  }

  if (!state) return <div className="card space-y-4">{error ? <p role="alert" className="text-[var(--pink)]">{error}</p> : <p role="status">Setting your table…</p>}<Link className="text-sm text-[var(--accent)]" to="/rooms">Back to rooms</Link></div>;

  return <div className="workspace-page">
    <header>
      <Link className="mb-5 inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--paper)]" to="/rooms"><ArrowLeft size={16} aria-hidden="true" />All rooms</Link>
      <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="page-heading min-w-0 break-words">{state.room.name}</h1><p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]"><Circle size={8} weight="fill" className={connected ? "text-[var(--green)]" : "text-[var(--pink)]"} aria-hidden="true" />{connected ? "Live at the table" : "Not connected"}</p></div>
      <p className="text-muted mt-3 break-all text-sm">Rule book <span className="ml-2 text-[var(--lavender)]">{state.room.rule_book.name}</span><span className="mx-3" aria-hidden="true">·</span>Invite your party with <span className="ml-2 select-all font-mono text-[var(--paper)]">{state.room.invite_code}</span></p>
    </header>
    {error && <p role="alert" className="rounded-lg border border-[var(--pink)]/30 p-4 text-sm text-[var(--pink)]">{error}</p>}
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:gap-6 2xl:grid-cols-[240px_minmax(0,1fr)_280px]">
      <div className="sticky top-4 z-30 col-start-1 row-start-1 min-w-0 md:row-span-2" onKeyDown={(event) => {
        if (event.key === "Escape" && toolsOpen) {
          setToolsOpen(false);
          toolsToggleRef.current?.focus();
        }
      }}>
        <button ref={toolsToggleRef} className="btn md:hidden!" type="button" aria-expanded={toolsOpen} aria-controls="room-tools-panel" onClick={() => setToolsOpen((open) => !open)}>
          <MapTrifold size={20} aria-hidden="true" />{toolsOpen ? "Close tools" : isDM ? "Map & tokens" : "Character & tokens"}
        </button>
        <aside id="room-tools-panel" className={`${toolsOpen ? "grid" : "hidden"} fixed inset-y-4 left-5 w-[300px] max-w-[calc(100vw-40px)] content-start gap-4 overflow-y-auto overscroll-contain rounded-xl border border-[var(--line)] bg-[var(--ink)] p-2 shadow-xl md:static md:-m-1 md:grid md:max-h-[calc(100dvh-32px)] md:w-auto md:max-w-none md:rounded-none md:border-0 md:bg-transparent md:p-1 md:shadow-none`} aria-label="Map and token controls">
          <button className="btn-secondary md:hidden!" type="button" onClick={() => {
            setToolsOpen(false);
            toolsToggleRef.current?.focus();
          }}>Close tools</button>
        {isDM && <form className="card space-y-4 p-5!" onSubmit={attachMap}>
          <h2 className="flex items-center gap-2 text-xl"><MapTrifold size={22} className="text-[var(--accent)]" aria-hidden="true" />Room map</h2>
          <p className="text-muted text-sm">Choose one of your maps and make it active at this table.</p>
          <label className="field-label block" htmlFor="room-map">Active map</label>
          <div className="flex flex-col gap-3">
            <select id="room-map" className="w-full min-w-0" value={mapChoice} onChange={(e) => setMapChoice(e.target.value)}>
              <option value="">Choose a map</option>
              {maps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="btn-secondary shrink-0" disabled={!mapChoice || mapChoice === currentMapId || busy}>{busy ? "Saving…" : "Set active map"}</button>
          </div>
          {maps.length === 0 && <p className="text-muted text-sm">No saved maps yet. Start a blank map below, or <Link className="text-[var(--accent)] underline underline-offset-4" to="/maps">create one in Maps</Link>.</p>}
        </form>}

        {isDM && <form className="card space-y-3 p-5!" onSubmit={startBlankMap}>
          <h2 className="text-xl">Start a blank map</h2>
          <p className="text-muted text-sm">Creates an empty map in your library and makes it active here right away.</p>
          <label className="field-label block" htmlFor="room-blank-map-name">Map name <span className="text-muted font-normal">(optional)</span></label>
          <input id="room-blank-map-name" className="w-full" value={blankMap.name} onChange={(e) => setBlankMap({ ...blankMap, name: e.target.value })} placeholder={`${state.room.name} map`} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label block" htmlFor="room-blank-map-width">Width (m)</label>
              <input id="room-blank-map-width" className="w-full" type="number" min="1" max="1000" step="1" required value={blankMap.width} onChange={(e) => setBlankMap({ ...blankMap, width: e.target.value })} />
            </div>
            <div>
              <label className="field-label block" htmlFor="room-blank-map-height">Height (m)</label>
              <input id="room-blank-map-height" className="w-full" type="number" min="1" max="1000" step="1" required value={blankMap.height} onChange={(e) => setBlankMap({ ...blankMap, height: e.target.value })} />
            </div>
          </div>
          <button className="btn-secondary w-full" disabled={busy}>{busy ? "Saving…" : "Start blank map"}</button>
        </form>}

        <form className="card space-y-3 p-5!" onSubmit={addToken}>
          <label className="field-label block" htmlFor={isDM ? "room-token-name" : "room-token-sheet"}>{isDM ? "Add a table token" : "Bring a character to the map"}</label>
          {isDM ? <>
            <input id="room-token-name" className="w-full" value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder={monsterChoice ? `${monsters.find((item) => item.id === monsterChoice)?.name ?? "Monster"} (numbered automatically)` : "Token name"} />
            {monsters.length > 0 && <>
              <label className="field-label block" htmlFor="room-token-monster">Monster <span className="text-muted font-normal">(optional)</span></label>
              <select id="room-token-monster" className="w-full min-w-0" value={monsterChoice} onChange={(e) => {
                setMonsterChoice(e.target.value);
                if (e.target.value) {
                  setSheet("");
                  setTokenName("");
                }
              }}>
                <option value="">No monster</option>
                {monsters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </>}
            <label className="field-label block" htmlFor="room-token-sheet">Character sheet <span className="text-muted font-normal">(optional)</span></label>
          </> : null}
          <div className="flex flex-col gap-3">
            <select id="room-token-sheet" className="w-full min-w-0" value={sheet} disabled={isDM && !!monsterChoice} onChange={(e) => setSheet(e.target.value)}>
              <option value="">{isDM ? "No character sheet" : "Choose a character sheet"}</option>
              {roomSheets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="btn shrink-0" disabled={(!isDM && !sheet) || busy}>{busy ? "Adding…" : "Add token"}</button>
          </div>
          {!isDM && roomSheets.length === 0 && <p className="text-muted text-sm">No {state.room.rule_book.name} characters yet. <Link className="text-[var(--accent)] underline underline-offset-4" to={`/sheets?room=${encodeURIComponent(state.room.id)}`}>Create a character</Link> to place a token.</p>}
          {isDM && <p className="text-muted text-sm">DM tokens do not require a character sheet. A monster token gets its own copy of the rule book's stat block and attacks; players never see its stats.</p>}
        </form>

        {isDM && <div className="card space-y-3 p-5!">
          <h2 className="text-xl">Place structure</h2>
          {!state.activeMap && <p className="text-muted text-sm">No map yet. Placing a structure starts a blank 30 × 30 m map for this room.</p>}
          <label className="field-label block" htmlFor="room-structure-kind">Structure type</label>
          <select id="room-structure-kind" className="w-full min-w-0" value={structureKind} onChange={(e) => {
            setStructureKind(e.target.value);
            setStructureBlocks(defaultBlocksForKind(e.target.value));
          }}>
            {structureTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <fieldset className="space-y-2">
            <legend className="field-label">This structure blocks</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={structureBlocks.blocks_vision} onChange={(e) => setStructureBlocks({ ...structureBlocks, blocks_vision: e.target.checked })} />Line of sight</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={structureBlocks.blocks_movement} onChange={(e) => setStructureBlocks({ ...structureBlocks, blocks_movement: e.target.checked })} />Movement</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={structureBlocks.blocks_attacks} onChange={(e) => setStructureBlocks({ ...structureBlocks, blocks_attacks: e.target.checked })} />Attacks</label>
          </fieldset>
          <button className={placingStructure ? "btn-secondary w-full" : "btn w-full"} type="button" aria-pressed={placingStructure} onClick={() => {
            if (placingStructure) {
              setPlacingStructure(false);
              return;
            }
            setPlacingStructure(true);
            setToolsOpen(false);
          }}>{placingStructure ? "Stop placing" : "Place on map"}</button>
        </div>}

        {isDM && <CheckPromptForm members={members} onPrompt={(request) => sendMap("check.prompt", request)} />}

        {attackEditorToken && <TokenAttacksEditor key={attackEditorToken.id} token={attackEditorToken} busy={busy}
          onSave={(attacks) => void update(() => patchJSON(`/api/rooms/${roomId}/tokens/${attackEditorToken.id}/attacks`, { attacks }))}
          onClose={() => setAttackEditorTokenId(null)} />}

        </aside>
      </div>
      <section className="col-start-1 row-start-2 min-w-0 space-y-3 md:col-start-2 md:row-start-1" aria-label="Tabletop">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl">{state.activeMap?.name ?? "The tabletop"}</h2><p className="text-muted text-xs">{state.metersPerGrid} m per grid square</p></div>
          <p className="text-muted text-xs">{isDM ? "Right-click a structure without dragging to choose Move or Rotate mode from the wheel. The mode stays active for every structure until you change it. Left-drag structures to apply the chosen mode; hold Shift while rotating to snap to 15°. Left-drag tokens to move them. Click any token without dragging to pick one of its attacks, then click a target. Select an object to hide it from or reveal it to players. Hold the right mouse button and drag to measure distance; release to hide the ruler. Use Place structure to add walls, doors, windows, cover or terrain to this room's map, and select a structure to remove it; these changes stay in this room and never alter the saved map." : "Left-drag your own character tokens to move them. Click one without dragging to pick an attack and see its range, then click a highlighted target; the dice roll automatically. Walls and other attack-blocking structures stop attacks unless they let attacks pass. Hold the right mouse button and drag to measure distance; release to hide the ruler."}</p>
          {isDM && <div className="grid grid-cols-1 items-center gap-3 rounded-lg border border-[var(--paper)]/10 bg-[var(--input)] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]" role="group" aria-label="Selected tabletop object">
            {selectedMapObject
              ? <p className="min-w-0 truncate text-sm text-[var(--paper)]"><span className="text-muted mr-2 text-xs uppercase tracking-[0.12em]">{mapSelection?.kind}</span>{selectedMapObjectLabel}<span className="text-muted ml-2 text-xs">{selectedMapObject.is_hidden ? "Hidden" : "Visible"}</span></p>
              : <p className="text-muted min-w-0 truncate text-sm">Select a token or structure on the map to manage its visibility.</p>}
            <div className="flex flex-wrap justify-end gap-2" role="group" aria-label="Selected object actions">
              <button className={`btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs${selectedMapObject ? "" : " invisible"}`} type="button" disabled={!selectedMapObject} aria-hidden={!selectedMapObject} onClick={toggleSelectedVisibility}>
                {selectedMapObject?.is_hidden ? <Eye size={16} aria-hidden="true" /> : <EyeSlash size={16} aria-hidden="true" />}
                {selectedMapObject?.is_hidden ? "Reveal to players" : "Hide from players"}
              </button>
              {selectedStructure && <button className="btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs" type="button" onClick={() => {
                if (!confirmRemove) {
                  setConfirmRemove(true);
                  return;
                }
                if (sendMap("structure.remove", { structureId: selectedStructure.id })) setMapSelection(null);
              }}>
                <Trash size={16} aria-hidden="true" />
                {confirmRemove ? "Confirm remove" : "Remove structure"}
              </button>}
            </div>
          </div>}
          <MapCanvas
            state={state}
            selectedTokenId={mapSelection?.kind === "token" ? mapSelection.id : undefined}
            selectedStructureId={mapSelection?.kind === "structure" ? mapSelection.id : undefined}
            movableTokenIds={movableTokenIds}
            canMoveStructures={isDM}
            rulerDistanceMeters={ruler}
            onSelect={setMapSelection}
            onMoveToken={(tokenId, to, path) => sendMap("token.move", { tokenId, to, path })}
            onMoveStructure={moveRoomStructure}
            onMeasure={measure}
            onAttack={(sourceTokenId, targetTokenId, attackId) => sendMap("attack.resolve", { sourceTokenId, targetTokenId, attackId })}
            onEditAttacks={(tokenId) => {
              setAttackEditorTokenId(tokenId);
              setToolsOpen(true);
            }}
            placingStructure={placingStructure ? { kind: structureKind } : null}
            onPlaceStructure={(geometry) => sendMap("structure.create", { kind: structureKind, geometry, ...structureBlocks })}
            onCancelPlacement={() => setPlacingStructure(false)}
          />
          {!state.activeMap && <p className="text-muted text-sm">{isDM ? "No map is active. Choose or start one in the Map & tokens controls, or use Place structure to start a blank map." : "No map is active. Ask your game master to choose a room map."}</p>}
      </section>
      <aside className="col-start-1 row-start-3 min-w-0 space-y-6 md:col-start-2 md:row-start-2 2xl:col-start-3 2xl:row-start-1 2xl:[&_.card]:p-5!" aria-label="Room members and chat">
        <section className="card">
          <h2 className="flex items-center gap-2 text-xl"><UsersThree size={22} className="text-[var(--accent)]" aria-hidden="true" />At the table</h2>
          <div className="mt-5 space-y-4">{members.length === 0 ? <p className="text-muted text-sm">No members to display.</p> : members.map((member) => <div className="space-y-2 border-t border-[var(--paper)]/10 pt-3" key={member.user_id}><div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm"><PlayerName player={{ id: member.user_id, username: member.username, pronouns: member.pronouns }} />{member.user_id === user?.id ? " (you)" : ""}</span><span className="shrink-0 text-xs text-[var(--muted)]">{member.is_dm ? "Game master" : "Player"}</span></div>{(isDM || member.user_id === user?.id) && <label className="block text-xs text-[var(--muted)]">{isDM ? "Assigned character" : "Your character"}<select className="mt-2 w-full text-sm" value={member.sheet_id ?? ""} disabled={busy} onChange={(e) => { const sheetId = e.target.value || null; void update(() => patchJSON(`/api/rooms/${roomId}/members/${member.user_id}`, { sheet_id: sheetId })); }}><option value="">No sheet</option>{roomSheets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>)}</div>
        </section>
        <RoomChecks checks={state.checks ?? []} members={members} currentUserId={user?.id} isDM={isDM}
          onRoll={(checkId, userId) => sendMap("check.roll", userId ? { checkId, userId } : { checkId })}
          onClose={(checkId) => sendMap("check.close", { checkId })} />
        <ChatPanel messages={state.chatHistory ?? []} members={members} isDM={isDM} onSend={(text, recipientUserIds, rollExpression) => send("chat.send", { text, recipientUserIds, rollExpression })} />
      </aside>
    </div>
  </div>;
}

function throttlePoint(fn: (from: Point, to: Point) => void, ms: number) {
  let last = 0;
  return (from: Point, to: Point) => {
    const now = Date.now();
    if (now - last > ms) {
      last = now;
      fn(from, to);
    }
  };
}

function activeMapId(state: VisibleRoomState) {
  return state.activeMap?.map_id ?? state.activeMap?.id ?? "";
}

function isChatMessage(body: unknown): body is ChatMessage {
  return !!body && typeof body === "object" && "id" in body && "room_id" in body && "sender_user_id" in body && "kind" in body && "body" in body && "created_at" in body;
}

function isMetersBody(body: unknown): body is { meters: number } {
  return !!body && typeof body === "object" && "meters" in body && typeof body.meters === "number";
}

function isErrorBody(body: unknown): body is { message: string } {
  return !!body && typeof body === "object" && "message" in body && typeof body.message === "string";
}
