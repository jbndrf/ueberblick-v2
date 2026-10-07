/**
 * What the deploy overview decides from a plan and the admin's picks (WP-360), as plain functions: which
 * mappings the admin must choose, which are filled in for them, and whether the confirm is allowed. No counts are
 * computed here (R1): every number comes from the plan the engine made.
 */
import { VERSION_DEPLOY_DEFAULT, type VersionDeployChoice } from '@ueberblick/core';
import type { ValueMapping } from '@ueberblick/server';
import type { DeployPlan, DeployRequest, MappingView } from './types';

export type Choices = Readonly<Record<string, VersionDeployChoice>>;
export type Picks = Readonly<Record<string, ValueMapping | undefined>>;

/** The choice for an Objektart: the admin's, else the default (owner P2 provisional (a)). */
export const choiceOf = (choices: Choices, type: string): VersionDeployChoice =>
  choices[type] ?? VERSION_DEPLOY_DEFAULT;

/** Objektarten that take the radio: only those with running Objekte (`running_floating`), as v3 showed it only for running cases. */
export const choosable = (plan: DeployPlan): readonly string[] =>
  plan.versions.filter((v) => v.running_floating > 0).map((v) => v.type);

/** The choices to send: one per Objektart that takes the radio, the default where the admin did not touch it. */
export function choicesToSend(plan: DeployPlan, choices: Choices): Choices {
  return Object.fromEntries(choosable(plan).map((t) => [t, choiceOf(choices, t)]));
}

/**
 * Whether the admin has to pick for this mapping. Nothing to pick when no Objekt holds a value of it, or when the
 * Objektart is kept and only running Objekte (which stay pinned) could hold it: then "Werte verwerfen" is the
 * truthful default and the row says so. Otherwise the admin chooses a target or discards (v3 `needsRemap`).
 */
export function needsPick(plan: DeployPlan, choices: Choices, m: MappingView): boolean {
  if (m.affected === 0) return false;
  const v = m.type === null ? undefined : plan.versions.find((x) => x.type === m.type);
  const keeps = v !== undefined && v.running_floating > 0 && choiceOf(choices, v.type) === 'keep';
  return !(keeps && v.settled_floating === 0);
}

/** The mappings of the request: the admin's pick where there is one, else "Werte verwerfen" for rows that need none. */
export function mappingsToSend(
  plan: DeployPlan,
  choices: Choices,
  picks: Picks,
): Record<string, ValueMapping> {
  const out: Record<string, ValueMapping> = {};
  for (const m of plan.mappings) {
    const pick = picks[m.path];
    if (pick !== undefined) out[m.path] = pick;
    else if (!needsPick(plan, choices, m)) out[m.path] = { discard: true };
  }
  return out;
}

/** The mapping rows still without an answer. */
export const missingPicks = (plan: DeployPlan, choices: Choices, picks: Picks): readonly MappingView[] =>
  plan.mappings.filter((m) => picks[m.path] === undefined && needsPick(plan, choices, m));

/** Why the confirm is off (`holdOf`); `null` means the admin may confirm. */
export const HOLD = {
  noPlan: 'no_plan',
  blockers: 'blockers',
  needsPick: 'needs_pick',
  noChanges: 'no_changes',
} as const;
export type Hold = (typeof HOLD)[keyof typeof HOLD];

export function holdOf(plan: DeployPlan | null, choices: Choices, picks: Picks): Hold | null {
  if (plan === null || plan.revision === null) return HOLD.noPlan;
  if (plan.blockers.length > 0) return HOLD.blockers;
  if (missingPicks(plan, choices, picks).length > 0) return HOLD.needsPick;
  if (plan.groups.length === 0 && !plan.first) return HOLD.noChanges;
  return null;
}

/** The deploy request for a plan the admin may confirm. */
export function requestOf(plan: DeployPlan, choices: Choices, picks: Picks): DeployRequest | null {
  if (plan.revision === null) return null;
  return {
    revision: plan.revision,
    mappings: mappingsToSend(plan, choices, picks),
    versions: choicesToSend(plan, choices),
  };
}
