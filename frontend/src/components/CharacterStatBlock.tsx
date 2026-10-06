import type { ReactNode } from "react";
import { actionSummary, sheetActionLists } from "../lib/actions";
import { attackSummary, dndAbilities } from "../lib/attacks";
import { creationLabel } from "../lib/characterCreation";
import { abilityShort, checkBonus, describeValue, numberValue, proficient, resolveAction, resolveAttack, sheetAbilities, signed, skillAbility } from "../lib/characterStats";

/** Sheet keys this block shows in its own sections; everything else is listed under Other details. */
const shownKeys: Record<string, true> = {
  class: true, level: true, hit_die: true, hit_points: true, max_hit_points: true, temporary_hit_points: true, armor_class: true,
  initiative: true, speed_m: true, proficiency_bonus: true, inspiration: true, death_save_successes: true, death_save_failures: true,
  stable: true, dead: true, saving_throw_proficiencies: true, skill_proficiencies: true, attacks: true, actions: true, items: true,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-3">
    <h4 className="mb-0 text-sm uppercase tracking-wide text-[var(--lavender)]">{title}</h4>
    {children}
  </section>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-[var(--line)] px-3 py-2">
    <dt className="text-muted text-xs">{label}</dt>
    <dd className="text-lg">{value}</dd>
  </div>;
}

/** A readable character sheet: vitals, ability scores, saves, skills, attacks, spells, items and other details. */
export function CharacterStatBlock({ data }: { data: Record<string, unknown> }) {
  const hp = numberValue(data.hit_points), max = numberValue(data.max_hit_points), temp = numberValue(data.temporary_hit_points);
  const vitals: { label: string; value: string }[] = [];
  if (hp !== undefined) vitals.push({ label: "Hit points", value: `${max !== undefined ? `${hp} / ${max}` : hp}${temp ? ` (+${temp} temporary)` : ""}` });
  const numbers: [string, string, (n: number) => string][] = [
    ["armor_class", "Armor class", String], ["initiative", "Initiative", signed], ["speed_m", "Speed", (n) => `${n} m`],
    ["proficiency_bonus", "Proficiency bonus", signed], ["level", "Level", String], ["hit_die", "Hit die", (n) => `d${n}`],
  ];
  for (const [key, label, format] of numbers) {
    const value = numberValue(data[key]);
    if (value !== undefined) vitals.push({ label, value: format(value) });
  }
  if (typeof data.inspiration === "boolean") vitals.push({ label: "Inspiration", value: data.inspiration ? "Yes" : "No" });

  const abilities = sheetAbilities(data);
  const saves = data.saving_throw_proficiencies && typeof data.saving_throw_proficiencies === "object" ? abilities : [];
  const skillGroup = data.skill_proficiencies;
  const skills = skillGroup && typeof skillGroup === "object" && !Array.isArray(skillGroup) ? Object.keys(skillGroup) : [];
  const successes = numberValue(data.death_save_successes) ?? 0, failures = numberValue(data.death_save_failures) ?? 0;
  const lists = sheetActionLists(data);
  const others = Object.entries(data).filter(([key]) => !shownKeys[key] && !dndAbilities.includes(key));

  return <div className="min-w-0 space-y-6">
    {vitals.length > 0 && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{vitals.map((stat) => <Stat key={stat.label} {...stat} />)}</dl>}
    {(successes > 0 || failures > 0 || data.stable === true || data.dead === true) && <p className="text-sm">
      Death saves: {successes} {successes === 1 ? "success" : "successes"} · {failures} {failures === 1 ? "failure" : "failures"}{data.dead === true ? " · Dead" : data.stable === true ? " · Stable" : ""}
    </p>}
    {abilities.length > 0 && <Section title="Ability scores">
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">{abilities.map(({ key, score, modifier }) => <div key={key} className="rounded-lg border border-[var(--line)] px-2 py-2 text-center">
        <dt className="text-muted text-xs" title={creationLabel(key)}>{abilityShort[key]}</dt>
        <dd className="text-xl" aria-label={`${creationLabel(key)} ${score}, modifier ${signed(modifier)}`}>{signed(modifier)}<span className="text-muted block text-xs">{score}</span></dd>
      </div>)}</dl>
    </Section>}
    {saves.length > 0 && <Section title="Saving throws">
      <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">{saves.map(({ key }) => <li key={key} className="flex justify-between gap-3">
        <span>{creationLabel(key)}{proficient(data, "saving_throw_proficiencies", key) && <span className="text-[var(--green)]"> · proficient</span>}</span>
        <span>{signed(checkBonus(data, key, "saving_throw_proficiencies", key))}</span>
      </li>)}</ul>
    </Section>}
    {skills.length > 0 && <Section title="Skills">
      <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">{skills.map((key) => {
        const ability = skillAbility[key];
        const isProficient = proficient(data, "skill_proficiencies", key);
        return <li key={key} className="flex justify-between gap-3">
          <span>{creationLabel(key)}{ability && <span className="text-muted"> ({abilityShort[ability]})</span>}{isProficient && <span className="text-[var(--green)]"> · proficient</span>}</span>
          <span>{ability ? signed(checkBonus(data, ability, "skill_proficiencies", key)) : isProficient ? "Yes" : "No"}</span>
        </li>;
      })}</ul>
    </Section>}
    {lists.attacks.length > 0 && <Section title="Attacks">
      <ul className="space-y-2 text-sm">{lists.attacks.map((attack) => <li key={attack.id}>{attack.name}<span className="text-muted block text-xs">{attackSummary(resolveAttack(attack, data))}</span></li>)}</ul>
    </Section>}
    {lists.actions.length > 0 && <Section title="Spells & abilities">
      <ul className="space-y-2 text-sm">{lists.actions.map((action) => <li key={action.id}>{action.name}<span className="text-muted block text-xs">{actionSummary(resolveAction(action, data))}</span></li>)}</ul>
    </Section>}
    {lists.items.length > 0 && <Section title="Items">
      <ul className="space-y-2 text-sm">{lists.items.map((item) => <li key={item.id}>{item.name}<span className="text-muted block text-xs">{actionSummary(resolveAction(item, data))}</span></li>)}</ul>
    </Section>}
    {others.length > 0 && <Section title="Other details">
      <dl className="space-y-2 text-sm">{others.map(([key, value]) => <div key={key} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
        <dt className="text-muted">{creationLabel(key)}</dt><dd className="min-w-0 break-words">{describeValue(key, value)}</dd>
      </div>)}</dl>
    </Section>}
  </div>;
}
