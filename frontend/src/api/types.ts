export type User = { id: string; username: string; email: string; pronouns: string; profile_complete: boolean };
export type Friend = {
  id: string;
  requester_user_id: string;
  addressee_user_id: string;
  status: "pending" | "accepted" | "blocked";
  blocked_by_user_id?: string | null;
  other_user: User;
  direction?: "inbound" | "outbound";
};
export type RuleBookRef = { id: string; name: string };
export type Room = {
  id: string;
  owner_id: string;
  name: string;
  is_public: boolean;
  invite_code: string;
  settings: Record<string, unknown>;
  rule_book: RuleBookRef;
};
/** Response of POST /api/rooms/join: the invite carries the room's rule book. */
export type RoomJoin = {
  room_id: string;
  rule_book: RuleBookRef;
  is_dm: boolean;
  sheet_id: string | null;
};
/** Response of GET /api/invites/{code}: what the invite leads to, before joining. */
export type InvitePreview = {
  room_id: string;
  name: string;
  rule_book: RuleBookRef;
  requires_password: boolean;
  member: { is_dm: boolean; sheet_id: string | null } | null;
};
export type RoomMember = {
  id: string;
  room_id: string;
  user_id: string;
  username?: string;
  pronouns?: string;
  sheet_id?: string | null;
  is_dm: boolean;
};
/** A user as shown in invitations and notifications. */
export type PublicUser = { id: string; username: string; pronouns: string };
/** A pending invitation to a room, as its invitee sees it. */
export type RoomInvitation = {
  id: string;
  created_at: string;
  room: { id: string; name: string; rule_book: RuleBookRef };
  inviter: PublicUser;
};
/** A pending invitation to a room, as the room's game masters see it. */
export type SentRoomInvitation = { id: string; room_id: string; created_at: string; invitee: PublicUser };
/** A user a game master may invite; `invited` when an invitation is already pending. */
export type InviteCandidate = PublicUser & { invited: boolean };
/** Response of GET /api/notifications: what waits for the signed-in user. */
export type NotificationsState = { friend_requests: Friend[]; room_invitations: RoomInvitation[] };
export type NotificationKind =
  | "friend.requested"
  | "friend.accepted"
  | "friend.changed"
  | "room_invitation.created"
  | "room_invitation.accepted"
  | "room_invitation.removed";
/** Pushed on GET /api/notifications/ws as `{type: "notification", body}`. */
export type AppNotification = { kind: NotificationKind; actor?: PublicUser; room?: { id: string; name: string } };
export type ClassChoice = {
  attribute: string;
  label: string;
  count: number;
  options: string[];
};
export type CharacterClass = {
  id: string;
  name: string;
  description?: string;
  defaults: Record<string, unknown>;
  choices?: ClassChoice[];
  /** Compendium ids the class pre-picks at character creation. */
  starting_equipment?: StartingEquipment;
  /** Compendium action ids the class may pick at creation; absent offers every action, empty none. */
  spell_list?: string[];
};
export type StartingEquipment = { attacks?: string[]; actions?: string[]; items?: string[] };
export type PointBuyRules = {
  attributes: string[];
  min: number;
  max: number;
  budget: number;
  costs: Record<string, number>;
  bonus_budget: number;
  bonus_max: number;
};
export type CreationRules = {
  classes?: CharacterClass[];
  point_buy?: PointBuyRules;
};
export type CharacterCreation = {
  class_id?: string;
  scores?: Record<string, number>;
  bonuses?: Record<string, number>;
  choices?: Record<string, string[]>;
};
export type RuleBook = {
  id: string;
  owner_id: string | null;
  name: string;
  is_public: boolean;
  attributes: Record<string, unknown>;
  creation_rules: CreationRules;
  monsters: Monster[];
  /** Weapons, spells and items characters can pick at creation. */
  compendium: ActionLists;
};
/** A rule book stat block. Placing it in a room copies `stats` (including `attacks`) into the token. */
export type Monster = {
  id: string;
  name: string;
  description: string;
  size_m: number;
  stats: Record<string, unknown>;
};
export type Sheet = {
  id: string;
  rule_book_id: string;
  user_id: string;
  name: string;
  data: Record<string, unknown>;
  is_public: boolean;
  creation: CharacterCreation;
};
export type MapStructure = {
  id: string;
  map_id?: string;
  kind: string;
  geometry: { x: number; y: number }[];
  blocks_vision: boolean;
  blocks_movement: boolean;
  blocks_attacks: boolean;
  cover_bonus: number;
  pass_rules: Record<string, boolean>;
  is_hidden?: boolean;
  /** Draw order inside the map (higher draws on top). Map endpoints always send it; room state does not. */
  z_index?: number;
  group_id?: string | null;
};
export type GameMap = {
  id: string;
  owner_id?: string;
  map_id?: string;
  name: string;
  is_public?: boolean;
  width_m: number | string;
  height_m: number | string;
  grid_size_m: number | string;
  background_asset_id?: string | null;
  structures?: MapStructure[];
};
export type TokenAttack = {
  id: string;
  name: string;
  range_m: number;
  ability: string;
  proficient: boolean;
  attack_bonus: number;
  damage: string;
  damage_bonus: number;
  damage_type: string;
};
export type ResolvedTokenAttack = TokenAttack & { to_hit: number; damage_modifier: number };
export type ActionKind = "attack" | "save" | "heal";
/** A stored spell or ability (sheet data or token attributes under "actions"). */
export type TokenAction = {
  id: string;
  name: string;
  kind: ActionKind;
  range_m: number;
  /** 0 targets one token; above 0 every token in the radius around a chosen point. */
  area_radius_m: number;
  ability: string;
  proficient: boolean;
  bonus: number;
  save_ability: string;
  half_on_save: boolean;
  dice: string;
  dice_bonus: number;
  ability_to_dice: boolean;
  damage_type: string;
  uses?: { max: number; remaining: number } | null;
};
export type ResolvedTokenAction = TokenAction & { to_hit: number; save_dc: number; dice_modifier: number };
export type TokenItem = Omit<TokenAction, "uses"> & { quantity: number };
export type ResolvedTokenItem = Omit<ResolvedTokenAction, "uses"> & { quantity: number };
export type ActionLists = { attacks: TokenAttack[]; actions: TokenAction[]; items: TokenItem[] };
export type DeathSaves = { successes: number; failures: number; stable: boolean; dead: boolean };
export type TokenDefenses = { armor_class: number | null; resistances: string[]; immunities: string[]; vulnerabilities: string[] };
export type RoomToken = {
  id: string;
  room_map_id?: string;
  sheet_id?: string | null;
  owner_user_id?: string | null;
  name: string;
  x_m: number | string;
  y_m: number | string;
  rotation_deg: number | string;
  size_m: number | string;
  vision_range_m: number | string;
  is_hidden: boolean;
  attributes: Record<string, unknown>;
  attacks?: ResolvedTokenAttack[];
  actions?: ResolvedTokenAction[];
  items?: ResolvedTokenItem[];
  /** Whether the viewer may edit this token's attacks, actions and items. */
  actions_editable?: boolean;
  /** Whether the viewer may act with this token (its owner or the game master). */
  can_act?: boolean;
  image_asset_id?: string;
  /** Players the game master lets move this token besides its owner; sent to game masters only. */
  mover_user_ids?: string[];
  /** Whether the viewer may move this token. */
  can_move?: boolean;
  /** Health reaches only the game master, the token owner and the owner of its sheet. */
  hit_points?: number;
  max_hit_points?: number;
  /** Sheet-backed tokens only, with the same visibility as health. */
  death_saves?: DeathSaves;
  /** Same visibility as health. */
  defenses?: TokenDefenses;
};
export type TokenPatch = {
  hit_points?: number;
  max_hit_points?: number;
  vision_range_m?: number;
  mover_user_ids?: string[];
  /** null clears the image. */
  image_asset_id?: string | null;
  armor_class?: number;
  resistances?: string[];
  immunities?: string[];
  vulnerabilities?: string[];
};
export type RollResult = {
  expression: string;
  dice: { count: number; sides: number; values: number[] }[];
  modifier: number;
  total: number;
  damage?: RollResult;
  /** Present when the roll answers a check prompted by the game master. */
  check?: CheckOutcome;
};
export type TargetResult =
  | "hit" | "critical" | "miss" | "saved" | "failed" | "healed" | "no_effect"
  | "success" | "failure" | "stable" | "dead" | "revived";
export type TargetOutcome = {
  token_id: string;
  name: string;
  /** The attack d20, the target's saving throw, or the death save. */
  roll?: RollResult;
  result: TargetResult;
  damage?: number;
  healing?: number;
  defense?: "resistant" | "immune" | "vulnerable";
  down?: boolean;
  dead?: boolean;
};
export type ActionOutcome = {
  name: string;
  kind: ActionKind | "death_save";
  source: "attack" | "action" | "item" | "death_save";
  source_token_id: string;
  dc?: number;
  save_ability?: string;
  damage_type?: string;
  /** The shared damage or healing roll. */
  effect?: RollResult;
  targets: TargetOutcome[];
  uses_left?: number;
  quantity_left?: number;
};
/** Chat roll of a resolved action, quick check aside. */
export type ActionRoll = { action: ActionOutcome };
export type CheckKind = "ability" | "save" | "skill" | "attribute";
export type CheckOutcome = {
  check_id: string;
  title: string;
  label: string;
  dc: number;
  success: boolean;
  user_id: string;
  character_name: string;
};
export type RoomCheckTarget = {
  user_id: string;
  roll: RollResult | null;
  success: boolean | null;
  rolled_at: string | null;
};
/** A check prompted by the game master. Private checks list only the viewer's own target unless they are a game master. */
export type RoomCheck = {
  id: string;
  title: string;
  kind: CheckKind;
  key: string;
  label: string;
  dc: number;
  is_private: boolean;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
  targets: RoomCheckTarget[];
};
export type ChatMessage = {
  id: string;
  room_id: string;
  sender_user_id: string;
  kind: "chat" | "dm" | "roll" | "system";
  body: string;
  roll?: RollResult | ActionRoll | null;
  recipient_user_ids?: string[];
  created_at: string;
};
export type VisibleRoomState = {
  room: Room;
  activeMap: GameMap | null;
  structures: MapStructure[];
  visibleTokens: RoomToken[];
  ownTokens: RoomToken[];
  chatHistory: ChatMessage[];
  /** Open checks first, then the most recent closed ones. */
  checks?: RoomCheck[];
  metersPerGrid: number | string;
  visibility?: {
    /** Players see fog everywhere outside their tokens' vision; game masters see no fog. */
    fog: boolean;
    /** What each of the viewer's tokens sees, cast from origin (the token's position at the time). */
    visionAreas: { tokenId: string; origin: { x: number; y: number }; polygon: { x: number; y: number }[] }[];
    visibleTokenIds: string[];
    visibleStructureIds: string[];
  };
};
/** A live drag by someone else at the table: where their dragged tokens are right now. */
export type TokenDragFrame = { room_id: string; moves: { token_id: string; x: number; y: number }[] };
export type ClientEnvelope = { type: string; requestId: string; body: unknown };
export type ServerEnvelope<T = unknown> = {
  type: string;
  requestId: string | null;
  body: T;
};
