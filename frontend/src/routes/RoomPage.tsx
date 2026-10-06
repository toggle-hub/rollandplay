import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Door, DoorOpen, Eye, EyeSlash, MapTrifold, Trash, UsersThree } from "@phosphor-icons/react";
import { apiFetch, connectRoomSocket, patchJSON, postJSON, requestId } from "../api/client";
import type { ChatMessage, GameMap, Monster, PresenceChange, RoomMember, Sheet, TokenDragFrame, TokenPatch, VisibleRoomState } from "../api/types";
import { useSession } from "../auth/SessionContext";
import { MapCanvas, type FloatingResult, type MapSelection } from "../components/MapCanvas";
import { ChatPanel } from "../components/ChatPanel";
import { CheckPromptForm } from "../components/CheckPromptForm";
import { RoomChecks } from "../components/RoomChecks";
import { PlayerName } from "../components/PlayerName";
import { PresenceDot } from "../components/PresenceDot";
import { ActionsEditor } from "../components/ActionsEditor";
import { TokenSettingsPanel } from "../components/TokenSettingsPanel";
import { CharacterStatusCard } from "../components/CharacterStatusCard";
import { RoomInvitePanel } from "../components/RoomInvitePanel";
import { TurnOrderStrip } from "../components/TurnOrderStrip";
import { RoomHeader, type RoomConnection } from "../components/RoomHeader";
import { RoomTabs } from "../components/RoomTabs";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toast";
import { BlankMapCard, RoomMapCard, StructureToolsCard, usePlacementStamp } from "../components/RoomMapTools";
import { useRoomStructureHistory } from "../lib/roomStructureHistory";
import { defaultBlocksForKind, structureLabel, type StructureBlocks } from "../lib/structures";
import { createFrameThrottle } from "../lib/frameThrottle";
import { floatText, isActionRoll } from "../lib/actions";
import { isClearedRuler, isSharedRuler, remoteRulers, type SharedRuler } from "../lib/rulers";
import { isPendingFor } from "../lib/checks";
import { createRefreshQueue, type RefreshQueue } from "../lib/refreshQueue";
import { keepSocketOpen } from "../lib/reconnectingSocket";
import { allRoomParts, partsToReload, type RoomPart } from "../lib/roomEvents";
import { useViewportFill } from "../lib/useViewportFill";
import { quickCheckGroups } from "../lib/checks";
import { useRuleBook } from "../lib/useRuleBook";

type Point = { x: number; y: number };

// Events arriving this close together reload the room once.
const refreshDelayMs = 40;
// Space kept under the table at the bottom of the window, matching the page's bottom padding.
const roomBottomGapPx = 16;

export function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const user = session.status === "authenticated" ? session.user : null;
  const [state, setState] = useState<VisibleRoomState | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [maps, setMaps] = useState<GameMap[]>([]);
  const [loadError, setLoadError] = useState("");
  const [connection, setConnection] = useState<RoomConnection>("connecting");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState("");
  const [mapChoice, setMapChoice] = useState("");
  const [tokenName, setTokenName] = useState("Encounter token");
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [monsterChoice, setMonsterChoice] = useState("");
  const [mapSelection, setMapSelection] = useState<MapSelection | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState("map");
  const [sideTab, setSideTab] = useState("chat");
  const [actionEditorTokenId, setActionEditorTokenId] = useState<string | null>(null);
  // Action results floated above the tokens they hit, each removed shortly after it arrives.
  const [floats, setFloats] = useState<FloatingResult[]>([]);
  const [structureKind, setStructureKind] = useState("wall");
  const [structureBlocks, setStructureBlocks] = useState<StructureBlocks>(() => defaultBlocksForKind("wall"));
  const [placingStructure, setPlacingStructure] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Tokens someone else is dragging right now, drawn at their live position until the drag ends or the move lands.
  const [remoteDrags, setRemoteDrags] = useState<ReadonlyMap<string, Point>>(() => new Map());
  // Members with the room open right now, from the room socket's presence.changed events.
  const [onlineUserIds, setOnlineUserIds] = useState<ReadonlySet<string>>(() => new Set());
  // Rulers others at the table are holding, by their connection.
  const [sharedRulers, setSharedRulers] = useState<ReadonlyMap<string, SharedRuler>>(() => new Map());
  // A token from the Add token form, waiting for a click on the map.
  const [placingToken, setPlacingToken] = useState<{ body: Record<string, unknown>; label: string; sizeM: number } | null>(null);
  const previousMapId = useRef("");
  const toolsToggleRef = useRef<HTMLButtonElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const refreshQueue = useRef<RefreshQueue<RoomPart> | null>(null);
  // Checks this page already knows; null until the first state arrives, so checks open on arrival don't alert.
  const knownChecks = useRef<Set<string> | null>(null);
  // Once the room has loaded, later failures become toasts instead of replacing the page.
  const loaded = useRef(false);
  const toast = useToast();
  const [gridRef, fill] = useViewportFill<HTMLDivElement>(roomBottomGapPx, 360);
  const ruleBook = useRuleBook(state?.room.rule_book.id);
  const myMember = members.find((member) => member.user_id === user?.id);
  const isDM = !!myMember?.is_dm;
  // Characters usable at this table: the room's rule book, and for players only their own sheets.
  const roomSheets = sheets.filter((item) => item.rule_book_id === state?.room.rule_book.id && (isDM || item.user_id === user?.id));
  const currentMapId = state ? activeMapId(state) : "";
  const movableTokenIds = useMemo(
    () => new Set(state?.visibleTokens.filter((token) => token.can_move).map((token) => token.id)),
    [state?.visibleTokens],
  );
  const rulerList = useMemo(() => remoteRulers(sharedRulers, members), [sharedRulers, members]);
  const selectedTokens = mapSelection?.kind === "tokens" ? state?.visibleTokens.filter((token) => mapSelection.ids.includes(token.id)) ?? [] : [];
  const removableTokens = selectedTokens.filter((token) => isDM || token.owner_user_id === user?.id);
  const selectedStructure = mapSelection?.kind === "structure" ? state?.structures.find((structure) => structure.id === mapSelection.id) : undefined;
  const hasSelection = selectedTokens.length > 0 || !!selectedStructure;
  const selectionHides = selectedTokens.length > 0 ? selectedTokens.some((token) => !token.is_hidden) : !selectedStructure?.is_hidden;
  const canManageSelectedToken = selectedTokens.length === 1 && (isDM || selectedTokens[0].owner_user_id === user?.id);
  const settingsToken = canManageSelectedToken ? selectedTokens[0] : undefined;
  const actionEditorToken = state?.visibleTokens.find((token) => token.id === actionEditorTokenId && token.actions_editable);
  // The game master's in-room structure changes, undoable with Undo or Ctrl/Cmd+Z.
  const structureHistory = useRoomStructureHistory(sendMap, currentMapId, isDM);
  const [stamp, setStamp] = usePlacementStamp(placingStructure);

  /** Reloads parts of the room over HTTP; requests close together share one round of fetches. */
  function refresh(...parts: RoomPart[]) {
    return refreshQueue.current?.request(...parts) ?? Promise.resolve();
  }

  useEffect(() => {
    setMapSelection(null);
    setActionEditorTokenId(null);
    // Placing the first structure in a map-less room starts a map; keep the brush active through that.
    if (previousMapId.current) setPlacingStructure(false);
    setPlacingToken(null);
    previousMapId.current = currentMapId;
  }, [currentMapId]);

  useEffect(() => setConfirmRemove(false), [mapSelection]);

  useEffect(() => {
    if (!isDM || !roomId) return;
    apiFetch<Monster[]>(`/api/rooms/${roomId}/monsters`).then((items) => setMonsters(items ?? [])).catch(() => setMonsters([]));
  }, [isDM, roomId]);

  // Selecting a token you manage shows its settings, which game masters find under Tokens.
  useEffect(() => {
    if (settingsToken) setToolsTab("tokens");
  }, [settingsToken?.id]);

  // A check the game master just asked this player to roll alerts with a Roll button right in the toast.
  useEffect(() => {
    if (!state) return;
    const checks = state.checks ?? [];
    const known = knownChecks.current;
    knownChecks.current = new Set([...(known ?? []), ...checks.map((check) => check.id)]);
    if (!known) return;
    for (const check of checks) {
      if (known.has(check.id) || !isPendingFor(check, user?.id)) continue;
      toast({
        kind: "info",
        message: `${check.title ? `${check.title}: the` : "The"} game master asks you for a roll: ${check.label}, DC ${check.dc}.`,
        action: { label: "Roll", onClick: () => sendMap("check.roll", { checkId: check.id }) },
      });
    }
  }, [state?.checks]);

  useEffect(() => {
    if (!roomId) return;
    setState(null);
    setLoadError("");
    setConnection("connecting");
    loaded.current = false;
    knownChecks.current = null;
    let active = true;
    const queue = createRefreshQueue<RoomPart>(async (parts) => {
      try {
        const [nextState, nextMembers, nextSheets, nextMaps] = await Promise.all([
          parts.has("state") ? apiFetch<VisibleRoomState>(`/api/rooms/${roomId}/state`) : null,
          parts.has("members") ? apiFetch<RoomMember[]>(`/api/rooms/${roomId}/members`) : null,
          parts.has("members") ? apiFetch<Sheet[]>("/api/sheets") : null,
          parts.has("maps") ? apiFetch<GameMap[]>("/api/maps") : null,
        ]);
        if (!active) return;
        if (nextState) {
          setState(nextState);
          setMapChoice((current) => current || activeMapId(nextState));
        }
        if (parts.has("members")) {
          setMembers(nextMembers ?? []);
          setSheets(nextSheets ?? []);
          setSheet((current) => current || nextMembers?.find((member) => member.user_id === user?.id)?.sheet_id || "");
        }
        if (parts.has("maps")) {
          setMaps(nextMaps ?? []);
          setMapChoice((current) => current || nextMaps?.[0]?.id || "");
        }
        loaded.current = true;
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Could not load this room.";
        if (loaded.current) toast({ kind: "error", message });
        else setLoadError(message);
      }
    }, refreshDelayMs);
    refreshQueue.current = queue;
    void queue.request(...allRoomParts);

    let reconnecting = false;
    const stopSocket = keepSocketOpen(() => connectRoomSocket(roomId, (event) => {
      structureHistory.observe(event);
      if (event.type === "room.deleted" || (event.type === "member.left" && isUserIdBody(event.body) && event.body.user_id === user?.id)) {
        stopSocket();
        setConnection("connecting");
        toast({ kind: "info", message: event.type === "room.deleted" ? "This room was deleted." : "You are no longer at this table." });
        navigate("/rooms");
        return;
      }
      if ((event.type === "chat.message" || event.type === "roll.result") && isChatMessage(event.body)) {
        const message = event.body;
        setState((current) => current ? { ...current, chatHistory: [...(current.chatHistory ?? []), message] } : current);
        // An action already changed the targets' hit points on the server; float the results and reload the health bars.
        const roll = message.roll;
        if (event.type === "roll.result" && roll && isActionRoll(roll)) {
          const results = roll.action.targets.map((target) => ({ id: `${message.id}:${target.token_id}`, tokenId: target.token_id, ...floatText(target) }));
          const ids = results.map((result) => result.id);
          setFloats((current) => [...current, ...results]);
          window.setTimeout(() => setFloats((current) => current.filter((result) => !ids.includes(result.id))), 3000);
          void queue.request("state");
        }
      }
      const parts = partsToReload(event.type);
      // The preview stays on the landing position until the reloaded state has the token there.
      if (event.type === "token.moved" && isTokenIdsBody(event.body)) {
        const ids = event.body.token_ids;
        void queue.request(...parts).then(() => setRemoteDrags((current) => withoutKeys(current, ids)));
      } else if (parts.length > 0) void queue.request(...parts);
      if (event.type === "map.activated" || event.type === "state.snapshot") {
        setRemoteDrags(new Map());
        setSharedRulers(new Map());
      }
      if (event.type === "token.dragging" && isDragFrame(event.body)) {
        const frame = event.body;
        setRemoteDrags((current) => {
          const next = new Map(current);
          frame.moves.forEach((move) => next.set(move.token_id, { x: move.x, y: move.y }));
          return next;
        });
      }
      if (event.type === "token.drag.ended" && isTokenIdsBody(event.body)) {
        const ids = event.body.token_ids;
        setRemoteDrags((current) => withoutKeys(current, ids));
      }
      if (event.type === "token.removed" && isTokenIdBody(event.body)) {
        const id = event.body.token_id;
        setRemoteDrags((current) => withoutKeys(current, [id]));
      }
      if (event.type === "presence.changed" && isPresenceBody(event.body)) setOnlineUserIds(new Set(event.body.online_user_ids));
      if (event.type === "ruler.shown" && isSharedRuler(event.body)) {
        const ruler = event.body;
        setSharedRulers((current) => new Map(current).set(ruler.conn_id, ruler));
      }
      if (event.type === "ruler.cleared" && isClearedRuler(event.body)) {
        const id = event.body.conn_id;
        setSharedRulers((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }
      if (event.type === "error" && isErrorBody(event.body)) toast({ kind: "error", message: event.body.message });
    }), {
      onOpen: (socket) => {
        wsRef.current = socket;
        setConnection("live");
        // The first connection's state.snapshot reloads the state; after a drop, anything may have changed.
        if (reconnecting) void queue.request(...allRoomParts);
      },
      onClose: () => {
        wsRef.current = null;
        reconnecting = true;
        setConnection("reconnecting");
        setRemoteDrags(new Map());
        setOnlineUserIds(new Set());
        setSharedRulers(new Map());
      },
    });
    return () => {
      active = false;
      dragFrames.cancel();
      measure.cancel();
      stopSocket();
      wsRef.current = null;
      queue.stop();
      refreshQueue.current = null;
    };
  }, [roomId]);

  function send(type: string, body: unknown, id: string = requestId()) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) throw new Error("The table is reconnecting. Try again in a moment.");
    wsRef.current.send(JSON.stringify({ type, requestId: id, body }));
  }

  function sendMap(type: string, body: unknown, id?: string) {
    try {
      send(type, body, id);
      return true;
    } catch (err) {
      toast({ kind: "error", message: err instanceof Error ? err.message : "Could not send the map action." });
      return false;
    }
  }

  // Live drag frames are best effort.
  function trySend(type: string, body: unknown) {
    try {
      send(type, body);
    } catch {
      // The drop or the next action reports a lost connection.
    }
  }

  function toggleSelectedVisibility() {
    if (!isDM) return;
    if (selectedTokens.length > 0) {
      for (const token of selectedTokens) {
        if (!sendMap("token.visibility", { tokenId: token.id, isHidden: selectionHides })) return;
      }
      return;
    }
    if (selectedStructure) sendMap("structure.visibility", { structureId: selectedStructure.id, isHidden: selectionHides });
  }
  function removeSelectedTokens() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    for (const token of removableTokens) {
      if (!sendMap("token.remove", { tokenId: token.id })) return;
    }
    setMapSelection(null);
  }
  // Only game masters open and close doors; an open door stops blocking movement, sight and attacks.
  function toggleDoor(door: { id: string; is_open?: boolean }) {
    if (isDM) sendMap("structure.door", { structureId: door.id, isOpen: !door.is_open });
  }
  function moveRoomStructure(structureId: string, geometry: Point[]) {
    const moved = state?.structures.find((structure) => structure.id === structureId);
    if (!moved || !structureHistory.move(moved, geometry)) return;
    setState((current) => current ? {
      ...current,
      structures: current.structures.map((structure) => structure.id === structureId ? { ...structure, geometry } : structure),
    } : current);
  }
  // Dropped tokens stay where they landed; a rejected move answers with an error, which reloads the room.
  function moveRoomTokens(type: string, body: unknown, moves: { tokenId: string; to: Point }[]) {
    // A last live frame at the landing position shows the table the drop before the move is stored.
    dragFrames.cancel();
    trySend("token.drag", { moves: moves.map(({ tokenId, to }) => ({ tokenId, to })) });
    if (!sendMap(type, body)) return;
    setState((current) => current ? {
      ...current,
      visibleTokens: current.visibleTokens.map((token) => {
        const move = moves.find((item) => item.tokenId === token.id);
        return move ? { ...token, x_m: move.to.x, y_m: move.to.y } : token;
      }),
    } : current);
  }

  const measure = useMemo(() => createFrameThrottle(({ from, to }: { from: Point; to: Point }) => trySend("ruler.measure", { from, to }), 50), [roomId]);
  const dragFrames = useMemo(() => createFrameThrottle((moves: { tokenId: string; to: Point }[]) => trySend("token.drag", { moves }), 50), [roomId]);

  /** Runs an HTTP change, then reloads the parts of the room it touched (the room state unless told otherwise). */
  async function update(action: () => Promise<unknown>, parts: RoomPart[] = ["state"]) {
    setBusy(true);
    try {
      await action();
      await refresh(...parts);
    } catch (err) {
      toast({ kind: "error", message: err instanceof Error ? err.message : "Could not update this room." });
    } finally {
      setBusy(false);
    }
  }

  function patchToken(tokenId: string, patch: TokenPatch) {
    return patchJSON(`/api/rooms/${roomId}/tokens/${tokenId}`, patch);
  }

  function uploadTokenImage(tokenId: string, file: File) {
    void update(async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);
      form.append("kind", "token");
      const asset = await apiFetch<{ id: string }>("/api/assets", { method: "POST", body: form });
      await patchToken(tokenId, { image_asset_id: asset.id });
    });
  }

  // Add token arms a placement: the token is created where the user next clicks the map.
  function addToken(e: FormEvent) {
    e.preventDefault();
    if (placingToken) {
      setPlacingToken(null);
      return;
    }
    const sheetName = sheets.find((item) => item.id === sheet)?.name;
    const monster = monsters.find((item) => item.id === monsterChoice);
    if (isDM) {
      // Monster tokens are named and numbered by the server unless the DM typed a name.
      const body = monster
        ? { monster_id: monster.id, name: tokenName.trim() || undefined }
        : { name: tokenName.trim() || sheetName || "Token", sheet_id: sheet || undefined };
      setPlacingToken({ body, label: tokenName.trim() || monster?.name || sheetName || "Token", sizeM: monster?.size_m ?? 1 });
    } else if (sheet) {
      setPlacingToken({ body: { sheet_id: sheet, name: sheetName ?? "Token" }, label: sheetName ?? "your character", sizeM: 1 });
    } else {
      return;
    }
    setPlacingStructure(false);
    setToolsOpen(false);
  }

  function placeToken(at: Point) {
    if (!placingToken) return;
    const { body } = placingToken;
    setPlacingToken(null);
    void update(() => postJSON(`/api/rooms/${roomId}/tokens`, { ...body, x_m: at.x, y_m: at.y }));
  }

  if (!state) return <div className="card space-y-4">{loadError ? <p role="alert" className="text-[var(--pink)]">{loadError}</p> : <p role="status">Setting your table…</p>}<Link className="text-sm text-[var(--accent)]" to="/rooms">Back to rooms</Link></div>;

  const openCheckCount = (state.checks ?? []).filter((check) => !check.closed_at).length;
  const myPendingChecks = (state.checks ?? []).filter((check) => isPendingFor(check, user?.id));
  const closeTools = () => {
    setToolsOpen(false);
    toolsToggleRef.current?.focus();
  };
  const tokenCards = <>
  {state.activeMap && <CharacterStatusCard tokens={state.visibleTokens} selectedTokenIds={selectedTokens.map((token) => token.id)} isDM={isDM} onSend={sendMap} />}
  {settingsToken && <TokenSettingsPanel key={settingsToken.id} token={settingsToken} isDM={isDM} canManage={canManageSelectedToken} members={members} busy={busy}
    onSave={(patch) => void update(() => patchToken(settingsToken.id, patch))}
    onUploadImage={(file) => uploadTokenImage(settingsToken.id, file)}
    onClearImage={() => void update(() => patchToken(settingsToken.id, { image_asset_id: null }))}
    onSend={sendMap} />}
  {!isDM && state.ownTokens.length > 0 ? <div className="card space-y-3 p-5!">
    <p className="text-muted text-sm">Your character is on the map. Select it and choose Remove token to bring a different one.</p>
  </div> : <form className="card space-y-3 p-5!" onSubmit={addToken}>
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
      <button className="btn shrink-0" disabled={(!isDM && !sheet) || busy}>{busy ? "Adding…" : placingToken ? "Cancel placing" : "Add token"}</button>
    </div>
    {!isDM && roomSheets.length === 0 && <p className="text-muted text-sm">No {state.room.rule_book.name} characters yet. <Link className="text-[var(--accent)] underline underline-offset-4" to={`/sheets?room=${encodeURIComponent(state.room.id)}`}>Create a character</Link> to place a token.</p>}
    {isDM && <p className="text-muted text-sm">DM tokens do not require a character sheet. A monster token gets its own copy of the rule book's stat block and attacks; players never see its stats.</p>}
  </form>}
  </>;

  return <div className="room-screen grid gap-3" style={{ "--room-fill": fill ? `${fill}px` : "70dvh" } as CSSProperties}>
    <RoomHeader room={state.room} connection={connection} isDM={isDM} toolsLabel={isDM ? "Map & tokens" : "Character & tokens"} toolsOpen={toolsOpen} toolsButtonRef={toolsToggleRef}
      onOpenTools={() => setToolsOpen(true)}
      onOpenChat={() => {
        setSideTab("chat");
        sideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        document.getElementById("chat-message")?.focus({ preventScroll: true });
      }} />
    <div ref={gridRef} className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[240px_minmax(0,1fr)] lg:h-[var(--room-fill)] lg:grid-cols-[240px_minmax(0,1fr)_300px] xl:grid-cols-[270px_minmax(0,1fr)_340px]">
      {toolsOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" aria-hidden="true" onClick={closeTools} />}
      <aside id="room-tools-panel" className={`${toolsOpen ? "flex" : "hidden"} fixed inset-y-3 left-3 z-50 w-[300px] max-w-[calc(100vw-24px)] min-w-0 flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--ink)] p-3 shadow-xl [&_.card]:p-4! md:static md:z-auto md:flex md:h-[var(--room-fill)] md:w-auto md:max-w-none md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none lg:h-full`} aria-label={isDM ? "Map and token tools" : "Character and token tools"} onKeyDown={(event) => {
        if (event.key === "Escape" && toolsOpen) closeTools();
      }}>
        <button className="btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs md:hidden!" type="button" onClick={closeTools}>Close tools</button>
        {isDM ? <RoomTabs label="Game master tools" idPrefix="room-tools" active={toolsTab} onChange={setToolsTab} className="min-h-0 flex-1" panelClassName="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain" tabs={[
          { id: "map", label: "Map", content: <>
        {roomId && <RoomMapCard roomId={roomId} state={state} maps={maps} mapChoice={mapChoice} onMapChoice={setMapChoice} busy={busy} run={(action) => void update(action, ["state", "maps"])} />}
        {roomId && <BlankMapCard roomId={roomId} roomName={state.room.name} busy={busy} run={(action) => void update(action, ["state", "maps"])} onCreated={setMapChoice} />}
          </> },
          { id: "tokens", label: "Tokens", content: tokenCards },
          { id: "structures", label: "Structures", content: <>
        <StructureToolsCard hasMap={!!state.activeMap} kind={structureKind} onKind={(kind) => {
          setStructureKind(kind);
          setStructureBlocks(defaultBlocksForKind(kind));
        }} blocks={structureBlocks} onBlocks={setStructureBlocks} placing={placingStructure} onTogglePlacing={() => {
          if (placingStructure) {
            setPlacingStructure(false);
            return;
          }
          setPlacingStructure(true);
          setPlacingToken(null);
          setToolsOpen(false);
        }} stamp={stamp} onStamp={setStamp} undoLabel={structureHistory.next?.label} canUndo={!!structureHistory.next?.ready} onUndo={structureHistory.undo} />
          </> },
          { id: "checks", label: "Checks", count: openCheckCount, content: <CheckPromptForm members={members} onPrompt={(request) => sendMap("check.prompt", request)} /> },
        ]} /> : <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">{tokenCards}</div>}
      </aside>
      <section className="flex h-[var(--room-fill)] min-h-0 min-w-0 flex-col gap-2 lg:h-full" aria-label="Tabletop">
        {myPendingChecks.length > 0 && <div className="max-h-40 shrink-0 overflow-y-auto overscroll-contain">
          <RoomChecks pinned checks={myPendingChecks} members={members} currentUserId={user?.id} isDM={false}
            onRoll={(checkId, userId, options) => sendMap("check.roll", { checkId, userId, ...options })}
            onClose={(checkId) => sendMap("check.close", { checkId })} />
        </div>}
        <TurnOrderStrip combat={state.combat} tokens={state.visibleTokens} isDM={isDM} currentUserId={user?.id} onSend={sendMap} />
        <div className="grid grid-cols-1 items-center gap-3 rounded-lg border border-[var(--paper)]/10 bg-[var(--input)] px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]" role="group" aria-label="Selected tabletop object">
          {selectedTokens.length === 1
            ? <p className="min-w-0 truncate text-sm text-[var(--paper)]"><span className="text-muted mr-2 text-xs uppercase tracking-[0.12em]">token</span>{selectedTokens[0].name}{isDM && <span className="text-muted ml-2 text-xs">{selectedTokens[0].is_hidden ? "Hidden" : "Visible"}</span>}</p>
            : selectedTokens.length > 1
              ? <p className="min-w-0 truncate text-sm text-[var(--paper)]">{`${selectedTokens.length} tokens selected`}</p>
              : selectedStructure
                ? <p className="min-w-0 truncate text-sm text-[var(--paper)]"><span className="text-muted mr-2 text-xs uppercase tracking-[0.12em]">structure</span>{selectedStructure.kind}<span className="text-muted ml-2 text-xs">{selectedStructure.kind === "door" && (selectedStructure.is_open ? "Open · " : "Closed · ")}{selectedStructure.is_hidden ? "Hidden" : "Visible"}</span></p>
                : <p className="text-muted min-w-0 truncate text-sm">{isDM ? "Select a token or structure on the map to manage it." : "Select your token on the map to manage it."}</p>}
          <div className="flex flex-wrap justify-end gap-2" role="group" aria-label="Selected object actions">
            {isDM && <button className={`btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs${hasSelection ? "" : " invisible"}`} type="button" disabled={!hasSelection} aria-hidden={!hasSelection} onClick={toggleSelectedVisibility}>
              {selectionHides ? <EyeSlash size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              {selectionHides ? "Hide from players" : "Reveal to players"}
            </button>}
            {removableTokens.length > 0 && <button className="btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs" type="button" onClick={removeSelectedTokens}>
              <Trash size={16} aria-hidden="true" />
              {confirmRemove ? "Confirm remove" : removableTokens.length > 1 ? `Remove ${removableTokens.length} tokens` : "Remove token"}
            </button>}
            {isDM && selectedStructure?.kind === "door" && <button className="btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs" type="button" onClick={() => toggleDoor(selectedStructure)}>
              {selectedStructure.is_open ? <Door size={16} aria-hidden="true" /> : <DoorOpen size={16} aria-hidden="true" />}
              {selectedStructure.is_open ? "Close door" : "Open door"}
            </button>}
            {selectedStructure && <button className="btn-secondary min-h-9 shrink-0 px-3 py-1.5 text-xs" type="button" onClick={() => {
              if (!confirmRemove) {
                setConfirmRemove(true);
                return;
              }
              if (!structureHistory.remove(selectedStructure)) return;
              setMapSelection(null);
              toast({ kind: "info", message: `${structureLabel(selectedStructure.kind)} removed from this table. Undo (Ctrl+Z) puts it back.` });
            }}>
              <Trash size={16} aria-hidden="true" />
              {confirmRemove ? "Confirm remove" : "Remove structure"}
            </button>}
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <MapCanvas
            state={state}
            selectedTokenIds={mapSelection?.kind === "tokens" ? mapSelection.ids : undefined}
            selectedStructureId={mapSelection?.kind === "structure" ? mapSelection.id : undefined}
            movableTokenIds={movableTokenIds}
            canMoveStructures={isDM}
            onSelect={setMapSelection}
            onMoveToken={(tokenId, to, path) => moveRoomTokens("token.move", { tokenId, to, path }, [{ tokenId, to }])}
            onMoveTokens={(moves) => moveRoomTokens("tokens.move", { moves }, moves)}
            remoteDragPositions={remoteDrags}
            floatingResults={floats}
            onDragTokens={(moves) => dragFrames.push(moves)}
            onDragTokensEnd={() => {
              dragFrames.cancel();
              trySend("token.drag.end", {});
            }}
            onMoveStructure={moveRoomStructure}
            onMeasure={(from, to) => measure.push({ from, to })}
            onMeasureEnd={() => {
              measure.cancel();
              trySend("ruler.clear", {});
            }}
            remoteRulers={rulerList}
            onAction={(request) => sendMap(request.type, request.body)}
            checkGroups={quickCheckGroups(ruleBook?.attributes)}
            onEditActions={(tokenId) => {
              setActionEditorTokenId(tokenId);
            }}
            placingStructure={placingStructure ? { kind: structureKind, ...stamp } : null}
            onPlaceStructure={(geometry) => structureHistory.place({ kind: structureKind, geometry, ...structureBlocks })}
            onToggleDoor={isDM ? toggleDoor : undefined}
            onCancelPlacement={() => setPlacingStructure(false)}
            placingToken={placingToken}
            onPlaceToken={placeToken}
            onCancelTokenPlacement={() => setPlacingToken(null)}
          />
        </div>
        {!state.activeMap && <p className="text-muted text-sm">{isDM ? "No map is active. Choose or start one in the Map & tokens controls, or use Place structure to start a blank map." : "No map is active. Ask your game master to choose a room map."}</p>}
      </section>
      <aside ref={sideRef} className="flex h-[min(85dvh,720px)] min-h-0 min-w-0 scroll-mt-3 flex-col md:col-span-2 lg:col-span-1 lg:h-full [&_.card]:p-4!" aria-label="Chat, checks and players">
        <RoomTabs label="Table" idPrefix="room-side" active={sideTab} onChange={setSideTab} className="min-h-0 flex-1" panelClassName="min-h-0 flex-1 overflow-y-auto overscroll-contain" tabs={[
          { id: "chat", label: "Chat", content: <ChatPanel key={roomId} roomId={roomId ?? ""} messages={state.chatHistory ?? []} hasEarlier={!!state.chatHasEarlier} members={members} isDM={isDM} onSend={(text, recipientUserIds, rollExpression) => send("chat.send", { text, recipientUserIds, rollExpression })} /> },
          { id: "checks", label: "Checks", count: openCheckCount, content: (state.checks ?? []).length === 0
            ? <p className="text-muted px-1 text-sm">No checks yet. {isDM ? "Ask for one under Checks in your tools." : "When the game master asks for a roll, it shows up here."}</p>
            : <RoomChecks checks={state.checks ?? []} members={members} currentUserId={user?.id} isDM={isDM}
              onRoll={(checkId, userId, options) => sendMap("check.roll", { checkId, userId, ...options })}
              onClose={(checkId) => sendMap("check.close", { checkId })} /> },
          { id: "players", label: "Players", count: members.length, content: <div className="space-y-3">
            <section className="card">
              <h2 className="flex items-center gap-2 text-xl"><UsersThree size={22} className="text-[var(--accent)]" aria-hidden="true" />At the table</h2>
              <div className="mt-5 space-y-4">{members.length === 0 ? <p className="text-muted text-sm">No members to display.</p> : members.map((member) => <div className="space-y-2 border-t border-[var(--paper)]/10 pt-3" key={member.user_id}><div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm"><PresenceDot online={onlineUserIds.has(member.user_id)} /><PlayerName player={{ id: member.user_id, username: member.username, pronouns: member.pronouns }} />{member.user_id === user?.id ? " (you)" : ""}</span><span className="shrink-0 text-xs text-[var(--muted)]">{member.is_dm ? "Game master" : "Player"}</span></div>{(isDM || member.user_id === user?.id) && <label className="block text-xs text-[var(--muted)]">{isDM ? "Assigned character" : "Your character"}<select className="mt-2 w-full text-sm" value={member.sheet_id ?? ""} disabled={busy} onChange={(e) => { const sheetId = e.target.value || null; void update(() => patchJSON(`/api/rooms/${roomId}/members/${member.user_id}`, { sheet_id: sheetId }), ["members"]); }}><option value="">No sheet</option>{roomSheets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>)}</div>
            </section>
            {isDM && roomId && <RoomInvitePanel roomId={roomId} memberCount={members.length} />}
          </div> },
        ]} />
      </aside>
    </div>
    {actionEditorToken && <Dialog name={{ labelledBy: `actions-heading-${actionEditorToken.id}` }} wide onClose={() => setActionEditorTokenId(null)}>
      <ActionsEditor key={actionEditorToken.id} owner={actionEditorToken} busy={busy}
        stats={actionEditorToken.sheet_id ? sheets.find((item) => item.id === actionEditorToken.sheet_id)?.data : actionEditorToken.attributes}
        onSave={(lists) => void update(() => patchJSON(`/api/rooms/${roomId}/tokens/${actionEditorToken.id}/actions`, lists))}
        onClose={() => setActionEditorTokenId(null)} />
    </Dialog>}
  </div>;
}

function activeMapId(state: VisibleRoomState) {
  return state.activeMap?.map_id ?? state.activeMap?.id ?? "";
}

function isChatMessage(body: unknown): body is ChatMessage {
  return !!body && typeof body === "object" && "id" in body && "room_id" in body && "sender_user_id" in body && "kind" in body && "body" in body && "created_at" in body;
}

function isPresenceBody(body: unknown): body is PresenceChange {
  return !!body && typeof body === "object" && "online_user_ids" in body && Array.isArray(body.online_user_ids);
}
function isTokenIdsBody(body: unknown): body is { token_ids: string[] } {
  return !!body && typeof body === "object" && "token_ids" in body && Array.isArray(body.token_ids);
}

function isTokenIdBody(body: unknown): body is { token_id: string } {
  return !!body && typeof body === "object" && "token_id" in body && typeof body.token_id === "string";
}

function isDragFrame(body: unknown): body is TokenDragFrame {
  return !!body && typeof body === "object" && "moves" in body && Array.isArray(body.moves);
}

function withoutKeys(map: ReadonlyMap<string, Point>, ids: readonly string[]): ReadonlyMap<string, Point> {
  if (!ids.some((id) => map.has(id))) return map;
  const next = new Map(map);
  ids.forEach((id) => next.delete(id));
  return next;
}

function isUserIdBody(body: unknown): body is { user_id: string } {
  return !!body && typeof body === "object" && "user_id" in body && typeof body.user_id === "string";
}

function isErrorBody(body: unknown): body is { message: string } {
  return !!body && typeof body === "object" && "message" in body && typeof body.message === "string";
}
