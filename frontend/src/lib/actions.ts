import type {
  ActionLists,
  ActionRoll,
  ResolvedTokenAction,
  ResolvedTokenAttack,
  ResolvedTokenItem,
  RollResult,
  RoomToken,
  RuleBook,
  TargetOutcome,
  TokenAction,
  TokenAttack,
  TokenItem,
} from "../api/types";
import { formatModifier } from "./attacks";
import { humanizeKey } from "./checks";
import type { Point } from "./geometryTransforms";
import { normalRoll, rollOptionsBody, type RollOptions, type RollOptionsBody } from "./rolls";

/** Same list and order as the server's `game.DamageTypes`. */
export const damageTypes = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

export type QuickCheck = { kind: "ability" | "save" | "skill"; key: string };

export type WheelChoice =
  | { kind: "attack"; attack: ResolvedTokenAttack }
  | { kind: "action"; action: ResolvedTokenAction }
  | { kind: "item"; item: ResolvedTokenItem }
  | { kind: "check"; check: QuickCheck }
  | { kind: "death_save" };

export type ActionRequest =
  | { type: "action.resolve"; body: { sourceTokenId: string; source: "attack" | "action" | "item"; actionId: string; targetTokenId?: string; point?: Point } & RollOptionsBody }
  | { type: "check.quick"; body: { tokenId: string; kind: string; key: string } & RollOptionsBody }
  | { type: "death.save"; body: { tokenId: string } & RollOptionsBody };

export type ChoiceTargeting = { rangeM: number; areaRadiusM: number; allowSelf: boolean; tone: "damage" | "heal" };

export type FloatTone = "damage" | "heal" | "miss" | "info";

export function isActionRoll(roll: RollResult | ActionRoll): roll is ActionRoll {
  return "action" in roll;
}

export function checkLabel(check: QuickCheck): string {
  return `${humanizeKey(check.key)} ${check.kind === "save" ? "saving throw" : "check"}`;
}

function signed(n: number): string {
  return n === 0 ? "+0" : formatModifier(n);
}

function withType(dice: string, modifier: number, damageType: string): string {
  return `${dice}${formatModifier(modifier)}${damageType ? ` ${damageType}` : ""}`;
}

export function actionSummary(a: ResolvedTokenAction | ResolvedTokenItem): string {
  const parts: string[] = [];
  if (a.kind === "attack") {
    parts.push(`${signed(a.to_hit)} to hit`, withType(a.dice, a.dice_modifier, a.damage_type));
  } else if (a.kind === "save") {
    parts.push(
      `${humanizeKey(a.save_ability)} save DC ${a.save_dc}`,
      withType(a.dice, a.dice_modifier, a.damage_type),
      a.half_on_save ? "half on save" : "no damage on save",
    );
  } else {
    parts.push(`${a.dice}${formatModifier(a.dice_modifier)} healing`);
  }
  if (a.area_radius_m > 0) parts.push(`${a.area_radius_m} m radius`);
  parts.push(`${a.range_m} m`);
  if ("quantity" in a) parts.push(`×${a.quantity}`);
  else if (a.uses) parts.push(`${a.uses.remaining}/${a.uses.max} uses`);
  return parts.join(" · ");
}

/** The name shown on the confirm card and in the targeting bar. */
export function choiceTitle(choice: WheelChoice): string {
  switch (choice.kind) {
    case "attack": return choice.attack.name;
    case "action": return choice.action.name;
    case "item": return choice.item.name;
    case "check": return checkLabel(choice.check);
    case "death_save": return "Death save";
  }
}

/** Targeted choices need a token or a point; checks and death saves roll straight away. */
export function choiceTargeting(choice: WheelChoice): ChoiceTargeting | null {
  switch (choice.kind) {
    case "attack":
      return { rangeM: choice.attack.range_m, areaRadiusM: 0, allowSelf: false, tone: "damage" };
    case "action":
    case "item": {
      const a = choice.kind === "action" ? choice.action : choice.item;
      return { rangeM: a.range_m, areaRadiusM: a.area_radius_m, allowSelf: a.kind === "heal", tone: a.kind === "heal" ? "heal" : "damage" };
    }
    default:
      return null;
  }
}

/** Whether the choice rolls the actor's own d20 (attack rolls, checks, death saves), which advantage and a bonus change. Save effects roll the targets' dice instead, and heals roll none. */
export function choiceUsesD20(choice: WheelChoice): boolean {
  switch (choice.kind) {
    case "attack":
    case "check":
    case "death_save":
      return true;
    case "action": return choice.action.kind === "attack";
    case "item": return choice.item.kind === "attack";
  }
}

/** The text of the confirm card: what will be rolled and what it costs. */
export function confirmLines(choice: WheelChoice, target?: RoomToken, areaCount?: number): string[] {
  if (choice.kind === "check") return [`${checkLabel(choice.check)}: 1d20 plus your modifier`];
  if (choice.kind === "death_save") return ["1d20: 10 or more succeeds, a 20 brings you back with 1 HP, a 1 counts as two failures"];
  if (choice.kind === "attack") {
    const a = choice.attack;
    return [
      `Attack roll 1d20${formatModifier(a.to_hit)} vs armor class`,
      `Damage ${withType(a.damage, a.damage_modifier, a.damage_type)} (dice doubled on a natural 20)`,
    ];
  }
  const a = choice.kind === "action" ? choice.action : choice.item;
  const lines: string[] = [];
  if (a.kind === "attack") {
    lines.push(
      `Attack roll 1d20${formatModifier(a.to_hit)} vs armor class`,
      `Damage ${withType(a.dice, a.dice_modifier, a.damage_type)} (dice doubled on a natural 20)`,
    );
  } else if (a.kind === "save") {
    const who = a.area_radius_m > 0 ? "Each creature rolls" : `${target?.name ?? "The target"} rolls`;
    lines.push(
      `${who} a ${humanizeKey(a.save_ability)} saving throw vs DC ${a.save_dc}`,
      `Damage ${withType(a.dice, a.dice_modifier, a.damage_type)}, ${a.half_on_save ? "half on a save" : "no damage on a save"}`,
    );
  } else {
    lines.push(`Healing ${a.dice}${formatModifier(a.dice_modifier)}`);
  }
  if (a.area_radius_m > 0 && areaCount === 0) lines.push("No creatures you can see are in the area");
  if (choice.kind === "item") lines.push(`Uses one (${choice.item.quantity} left)`);
  else if (choice.action.uses) lines.push(`Uses 1 of ${choice.action.uses.remaining}/${choice.action.uses.max} left`);
  return lines;
}

/** Builds the websocket request the confirm card's Roll button sends; roll options apply only to choices that roll a d20. */
export function choiceRequest(sourceTokenId: string, choice: WheelChoice, targetTokenId?: string, point?: Point, options: RollOptions = normalRoll): ActionRequest {
  const extra = choiceUsesD20(choice) ? rollOptionsBody(options) : {};
  switch (choice.kind) {
    case "check":
      return { type: "check.quick", body: { tokenId: sourceTokenId, kind: choice.check.kind, key: choice.check.key, ...extra } };
    case "death_save":
      return { type: "death.save", body: { tokenId: sourceTokenId, ...extra } };
    default: {
      const actionId = choice.kind === "attack" ? choice.attack.id : choice.kind === "action" ? choice.action.id : choice.item.id;
      const body: Extract<ActionRequest, { type: "action.resolve" }>["body"] = { sourceTokenId, source: choice.kind, actionId, ...extra };
      if (targetTokenId) body.targetTokenId = targetTokenId;
      if (point) body.point = point;
      return { type: "action.resolve", body };
    }
  }
}

const deathSaveText: Partial<Record<TargetOutcome["result"], { text: string; tone: FloatTone }>> = {
  success: { text: "Success", tone: "info" },
  failure: { text: "Failure", tone: "damage" },
  stable: { text: "Stable", tone: "heal" },
  dead: { text: "Dead", tone: "damage" },
  revived: { text: "Back up!", tone: "heal" },
};

/** The short label floated above a token after an action resolves. */
export function floatText(t: TargetOutcome): { text: string; tone: FloatTone } {
  const damage = t.damage ?? 0;
  let out: { text: string; tone: FloatTone };
  const deathSave = deathSaveText[t.result];
  if (t.result === "miss") out = { text: "Miss", tone: "miss" };
  else if (deathSave) out = deathSave;
  else if (t.defense === "immune") out = { text: "Immune", tone: "info" };
  else if (t.result === "critical") out = { text: `Crit -${damage}`, tone: "damage" };
  else if (damage > 0) out = { text: `-${damage}`, tone: "damage" };
  else if (t.result === "saved") out = { text: "Saved", tone: "info" };
  else if (t.result === "healed") out = { text: `+${t.healing ?? 0}`, tone: "heal" };
  else if (t.result === "no_effect") out = { text: "No effect", tone: "info" };
  else out = { text: humanizeKey(t.result), tone: "info" };
  if (t.down) out = { ...out, text: `${out.text} · Down` };
  if (t.dead && t.result !== "dead") out = { ...out, text: `${out.text} · Dead` };
  return out;
}

export function isDown(t: RoomToken): boolean {
  return t.hit_points === 0 && (t.max_hit_points ?? 0) > 0;
}

export function canDeathSave(t: RoomToken): boolean {
  return !!t.sheet_id && isDown(t) && !t.death_saves?.dead && !t.death_saves?.stable;
}

export function emptyActionLists(): ActionLists {
  return { attacks: [], actions: [], items: [] };
}

function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

/** The attacks, actions and items stored in sheet data; a missing or malformed list is empty. */
export function sheetActionLists(data: Record<string, unknown>): ActionLists {
  return { attacks: listOf<TokenAttack>(data.attacks), actions: listOf<TokenAction>(data.actions), items: listOf<TokenItem>(data.items) };
}

export function hasCompendium(lists: ActionLists): boolean {
  return lists.attacks.length > 0 || lists.actions.length > 0 || lists.items.length > 0;
}

function byIds<T extends { id: string }>(entries: T[], ids: string[] = []): T[] {
  return ids.flatMap((id) => entries.filter((entry) => entry.id === id).slice(0, 1));
}

/** The compendium entries a class grants as starting equipment, in kit order; unknown ids are skipped. */
export function startingLists(book: RuleBook, classId?: string): ActionLists {
  const kit = book.creation_rules.classes?.find((cls) => cls.id === classId)?.starting_equipment;
  if (!kit) return emptyActionLists();
  return {
    attacks: byIds(book.compendium.attacks, kit.attacks),
    actions: byIds(book.compendium.actions, kit.actions),
    items: byIds(book.compendium.items, kit.items),
  };
}

function picked<T extends { id: string }>(values: T[], picks: T[]): T[] {
  return [...values.filter((entry) => !picks.some((pick) => pick.id === entry.id)), ...picks];
}

/** Appends the picks to the values, a pick replacing the value with the same id. */
export function withPicks(values: ActionLists, picks: ActionLists): ActionLists {
  return { attacks: picked(values.attacks, picks.attacks), actions: picked(values.actions, picks.actions), items: picked(values.items, picks.items) };
}

/** A one-line description of an unresolved entry, before any character's modifiers apply. */
export function compendiumSummary(entry: TokenAttack | TokenAction | TokenItem): string {
  if ("damage" in entry) return `${withType(entry.damage, entry.damage_bonus, entry.damage_type)} · ${entry.range_m} m`;
  const parts: string[] = [];
  if (entry.kind === "attack") {
    parts.push("Attack roll", withType(entry.dice, entry.dice_bonus, entry.damage_type));
  } else if (entry.kind === "save") {
    parts.push(`${humanizeKey(entry.save_ability)} save`, withType(entry.dice, entry.dice_bonus, entry.damage_type));
    if (entry.half_on_save) parts.push("half on save");
    if (entry.area_radius_m > 0) parts.push(`${entry.area_radius_m} m radius`);
  } else {
    parts.push("Healing", `${entry.dice}${formatModifier(entry.dice_bonus)}${entry.ability_to_dice ? " + modifier" : ""}`);
  }
  parts.push(`${entry.range_m} m`);
  if ("quantity" in entry) parts.push(`×${entry.quantity}`);
  return parts.join(" · ");
}
