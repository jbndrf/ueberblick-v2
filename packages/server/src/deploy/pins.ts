/**
 * The deploy choice "belassen / verschieben" per Objektart (WP-317, A-029 item 5). Which types a deploy changed, how many
 * features each choice would touch (one SQL count per type), the validation of the request's choices, and the pin
 * writes: one `$pin` system run per running floating feature of a type whose choice is `keep`, written through the
 * project's store inside the deploy transaction, before the new version becomes the deployed one (R3, one write path).
 */
import {
  formatKeyPath,
  isOrderOnly,
  keepsValuesSql,
  LIFECYCLE_STATES,
  parseKeyPath,
  PIN_TASK,
  RUNNING_LIFECYCLE,
  VERSION_DEPLOY_CHOICES,
  VERSION_DEPLOY_DEFAULT,
  type DiffEntry,
  type FeatureId,
  type Key,
  type Problem,
  type Run,
  type TemplateFile,
  type VersionDeployChoice,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import { SYSTEM_ACTOR } from '../timers/fire';
import type { PinDeps, VersionChoices, VersionPlan } from './contract';

/** Features per `submitBatch` while pinning; the batch is part of the deploy transaction. */
export const PIN_BATCH_SIZE = 500;

const text = (en: string, de: string) => ({ en, de });
const pathOf = (type: string): string => formatKeyPath(['versions', type]);

/** The type keys a task's `on` names (a key, a list, or the special offers `$map` / `$none`, which name none). */
function typesOfOn(on: unknown): string[] {
  const list = Array.isArray(on) ? on : [on];
  return list.filter((t): t is string => typeof t === 'string' && !t.startsWith('$'));
}

/**
 * The feature types a task belongs to: where it is offered and what it creates. Its automatic actions
 * (`tasks.<t>.auto.<name>`) belong to the same types: an edit of one is a change of its task (C-004).
 */
function typesOfTask(file: TemplateFile | undefined, key: string): string[] {
  const t = file?.tasks?.[key];
  return t === undefined ? [] : [...typesOfOn(t.on), ...(t.creates === undefined ? [] : [t.creates])];
}

/**
 * The types the deploy changed: any diff entry under `types.<type>`, or under a task (its automatic actions included) that is offered on, creates
 * or watches the type (in the deployed file or the new one). A removed type counts: its running features can be kept.
 * An `order_changed` entry touches no feature (A-042), so by default it names no type: a type whose only change is an
 * order has no keep / move choice (`isOrderOnly`, the rule of `buildPlan`'s `affected`, WP-411). `withOrder` lists those types too (the
 * deploy overview groups its order lines under them).
 */
export function changedTypes(
  before: TemplateFile | undefined,
  after: TemplateFile,
  changes: readonly DiffEntry[],
  options: { readonly withOrder?: boolean } = {},
): ReadonlySet<string> {
  const byType = new Map<string, DiffEntry[]>();
  const add = (type: string, e: DiffEntry): void => void byType.set(type, [...(byType.get(type) ?? []), e]);
  for (const e of changes) {
    const [section, key] = parseKeyPath(e.path) ?? [];
    if (key === undefined) continue;
    if (section === 'types') add(key, e);
    else if (section === 'tasks')
      for (const t of new Set([...typesOfTask(before, key), ...typesOfTask(after, key)])) add(t, e);
  }
  return new Set(
    [...byType].filter(([, es]) => options.withOrder === true || !isOrderOnly(es)).map(([t]) => t),
  );
}

const SETTLED = LIFECYCLE_STATES.entries
  .filter((s) => s.keepsValues && s.key !== RUNNING_LIFECYCLE)
  .map((s) => `'${s.key}'`)
  .join(',');

/**
 * The counts of the changed types that have running features; one SQL per type. `running_floating` are the features a
 * `keep` would pin, `already_pinned` stay pinned either way, `settled_floating` always move (P1 (a)). Deleted features
 * count nowhere.
 */
export function versionPlans(db: Db, types: ReadonlySet<string>): readonly VersionPlan[] {
  const stmt = db.prepare<{
    rf: number | null;
    ap: number | null;
    sf: number | null;
    running: number | null;
  }>(
    `SELECT
       sum(pinned_version IS NULL AND lifecycle = '${RUNNING_LIFECYCLE}') AS rf,
       sum(pinned_version IS NOT NULL) AS ap,
       sum(pinned_version IS NULL AND lifecycle IN (${SETTLED})) AS sf,
       sum(lifecycle = '${RUNNING_LIFECYCLE}') AS running
     FROM features WHERE type = ? AND ${keepsValuesSql('lifecycle')}`,
  );
  const out: VersionPlan[] = [];
  for (const type of [...types].sort()) {
    const r = stmt.get(type);
    if (r === undefined || (r.running ?? 0) === 0) continue;
    out.push({
      type,
      running_floating: r.rf ?? 0,
      already_pinned: r.ap ?? 0,
      settled_floating: r.sf ?? 0,
    });
  }
  return out;
}

/** A choice for a type that is unknown, unchanged by this deploy, or has no running features, is a typed problem. */
export function checkChoices(
  choices: VersionChoices,
  plans: readonly VersionPlan[],
  changed: ReadonlySet<string>,
  known: (type: string) => boolean,
): readonly Problem[] {
  const open = new Set(plans.map((p) => p.type));
  const problems: Problem[] = [];
  for (const [type, choice] of Object.entries(choices)) {
    if (!VERSION_DEPLOY_CHOICES.has(choice)) {
      problems.push({
        path: pathOf(type),
        code: 'schema_invalid',
        message: text(
          `"${String(choice)}" is not a choice for "${type}".`,
          `"${String(choice)}" ist keine Auswahl für "${type}".`,
        ),
        hint: `Use one of: ${VERSION_DEPLOY_CHOICES.keys.join(', ')}.`,
      });
      continue;
    }
    if (open.has(type)) continue;
    const [en, de] = !known(type)
      ? [`"${type}" is not a type of this project.`, `"${type}" ist keine Objektart dieses Projekts.`]
      : !changed.has(type)
        ? [
            `"${type}" is not changed by this deploy, so it takes no choice.`,
            `"${type}" wird von diesem Deploy nicht geändert und braucht keine Auswahl.`,
          ]
        : [
            `"${type}" has no running objects, so it takes no choice.`,
            `"${type}" hat keine laufenden Objekte und braucht keine Auswahl.`,
          ];
    problems.push({
      path: pathOf(type),
      code: 'unknown_path',
      message: text(en, de),
      hint: 'Remove the choice, or check the types in the plan.',
    });
  }
  return problems;
}

/** The types whose choice is `keep`: the request's, with `VERSION_DEPLOY_DEFAULT` for the types it does not name. */
export function typesToKeep(plans: readonly VersionPlan[], choices: VersionChoices): readonly string[] {
  const choiceOf = (type: string): VersionDeployChoice => choices[type] ?? VERSION_DEPLOY_DEFAULT;
  return plans.filter((p) => p.running_floating > 0 && choiceOf(p.type) === 'keep').map((p) => p.type);
}

/**
 * Pins every running floating feature of `types` to `version` (the version deployed now), in batches of
 * `PIN_BATCH_SIZE`: one `$pin` system run each through `pins.store`. Call inside the deploy transaction while `version`
 * is still the deployed one. A refusal throws and rolls the deploy back: a half-kept type would be worse than none.
 * Returns the number of features pinned.
 */
export function writePins(db: Db, pins: PinDeps, types: readonly string[], version: number): number {
  const select = db.prepare<{ id: string }>(
    `SELECT id FROM features WHERE type = ? AND lifecycle = '${RUNNING_LIFECYCLE}' AND pinned_version IS NULL
       AND id > ? ORDER BY id LIMIT ?`,
  );
  let pinned = 0;
  for (const type of types) {
    for (let after = ''; ;) {
      const ids = select.all(type, after, PIN_BATCH_SIZE).map((r) => r.id);
      if (ids.length === 0) break;
      const runs: Run[] = ids.map((id) => ({
        id: pins.ids.runId(),
        task: PIN_TASK as Key,
        actor: SYSTEM_ACTOR,
        configVersion: version,
        featureId: id as FeatureId,
        input: { version },
      }));
      const r = pins.store.submitBatch(runs);
      if (r.outcome !== 'accepted')
        throw new Error(`pinning ${type} to version ${version} was refused: ${r.refusal.code}`);
      pinned += ids.length;
      after = ids[ids.length - 1] as string;
    }
  }
  return pinned;
}
