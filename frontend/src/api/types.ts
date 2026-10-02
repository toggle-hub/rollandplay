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
};
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
};
export type ResolvedTokenAttack = TokenAttack & { to_hit: number; damage_modifier: number };
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
  vision_angle_deg: number | string;
  is_hidden: boolean;
  attributes: Record<string, unknown>;
  attacks?: ResolvedTokenAttack[];
  attacks_editable?: boolean;
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
  roll?: RollResult | null;
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
    fogPolygon: { x: number; y: number }[];
    visibleTokenIds: string[];
    visibleStructureIds: string[];
  };
};
export type ClientEnvelope = { type: string; requestId: string; body: unknown };
export type ServerEnvelope<T = unknown> = {
  type: string;
  requestId: string | null;
  body: T;
};
