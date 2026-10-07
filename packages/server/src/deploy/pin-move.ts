/**
 * The manual move of pinned Objekte to the deployed version (WP-368, owner P3, A-029 item 5): "Auf aktuelle Version
 * verschieben" on the Versionen page. The plan is the existing diff (`core.diff`) between the pinned version and the
 * deployed one, with `affected` counted over exactly the features pinned to that version (`move-select.ts`, `pinnedTo`).
 * The move is one `$pin` unpin run per pinned feature (every lifecycle state, P1) plus the `$move` runs of the chosen
 * mappings, all through `pins.store` (R3), batched like a deploy and inside one transaction: a refusal anywhere rolls
 * everything back. Afterwards the version has no pins, so sync's live set drops it (WP-316).
 */
import {
  diff,
  formatKeyPath,
  MOVE_TASK,
  PIN_TASK,
  type FeatureId,
  type Key,
  type Problem,
  type Run,
  type TemplateFile,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import { SYSTEM_ACTOR } from '../timers/fire';
import type { PinDeps, PlannedChange, ValueMapping } from './contract';
import { inputOf } from './move-executor';
import { affectedCount, featuresToMove, type MovePayload } from './move-select';
import { checkMappings } from './moves';
import { PIN_BATCH_SIZE } from './pins';
import { deployedVersion, loadData } from './versions';

/** What moving the pins of `from` to the deployed version `to` would do. */
export interface PinMovePlan {
  readonly from: number;
  readonly to: number;
  /** Features pinned to `from`, in every lifecycle state. */
  readonly pinned: number;
  /** The same per Objektart. */
  readonly types: readonly { readonly type: string; readonly count: number }[];
  /** The differences between the two versions; `affected` counts only the features pinned to `from`. */
  readonly diff: readonly PlannedChange[];
}

export type PinMovePlanResult =
  | { readonly ok: true; readonly plan: PinMovePlan }
  | { readonly ok: false; readonly problems: readonly Problem[] };

export type PinMoveResult =
  | {
      readonly ok: true;
      readonly from: number;
      readonly to: number;
      /** `$pin` runs: the features that now float on the deployed version. */
      readonly unpinned: number;
      /** `$move` runs: the values moved to another option or property. */
      readonly moved: number;
    }
  | { readonly ok: false; readonly problems: readonly Problem[] };

const problem = (path: string, code: Problem['code'], en: string, de: string, hint: string): Problem => ({
  path,
  code,
  message: { en, de },
  hint,
});
const versionPath = (v: number): string => formatKeyPath(['versions', String(v)]);

/** Pinned features per version (any state), the "n Objekte auf Version k" of the Versionen page; one pass over the partial index `features_pinned`. */
export function pinCounts(db: Db): Readonly<Record<number, number>> {
  const rows = db
    .prepare<{ v: number; n: number }>(
      'SELECT pinned_version AS v, count(*) AS n FROM features WHERE pinned_version IS NOT NULL GROUP BY pinned_version',
    )
    .all();
  return Object.fromEntries(rows.map((r) => [r.v, r.n]));
}

interface Ends {
  readonly from: number;
  readonly to: number;
  readonly before: TemplateFile;
  readonly after: TemplateFile;
}

function ends(db: Db, from: number): Ends | readonly Problem[] {
  const deployed = deployedVersion(db);
  const before = loadData(db, from)?.file;
  if (deployed === undefined || before === undefined)
    return [
      problem(
        versionPath(from),
        'unknown_path',
        `There is no version ${from} to move from.`,
        `Es gibt keine Version ${from}, von der verschoben werden kann.`,
        'Pick a version from the list.',
      ),
    ];
  const after = loadData(db, deployed.version)?.file;
  if (after === undefined) throw new Error(`deployed version ${deployed.version} has no stored config`);
  if (from === deployed.version)
    return [
      problem(
        versionPath(from),
        'unknown_path',
        `Version ${from} is the deployed one, so nothing is pinned to an older version.`,
        `Version ${from} ist die aktive Version, es gibt nichts auf einer älteren Version zu verschieben.`,
        'Pick an older version.',
      ),
    ];
  return { from, to: deployed.version, before, after };
}

/** The dry run: counts and differences, nothing is written. */
export function planPinMove(db: Db, from: number): PinMovePlanResult {
  const e = ends(db, from);
  if (Array.isArray(e)) return { ok: false, problems: e };
  const { to, before, after } = e as Ends;
  const types = db
    .prepare<{ type: string; n: number }>(
      'SELECT type, count(*) AS n FROM features WHERE pinned_version = ? GROUP BY type ORDER BY type',
    )
    .all(from)
    .map((r) => ({ type: r.type, count: r.n }));
  const pinned = types.reduce((sum, t) => sum + t.count, 0);
  if (pinned === 0)
    return {
      ok: false,
      problems: [
        problem(
          versionPath(from),
          'unknown_path',
          `No Objekte are pinned to version ${from}.`,
          `Auf Version ${from} sind keine Objekte festgehalten.`,
          'There is nothing to move.',
        ),
      ],
    };
  const dropped = types.filter((t) => after.types?.[t.type] === undefined);
  if (dropped.length > 0)
    return {
      ok: false,
      problems: dropped.map((t) =>
        problem(
          formatKeyPath(['types', t.type]),
          'dangling_reference',
          `"${t.type}" is not in the deployed version, so its ${t.count} pinned Objekte cannot move.`,
          `„${t.type}“ gibt es in der aktiven Version nicht mehr, die ${t.count} festgehaltenen Objekte können nicht verschoben werden.`,
          'Bring the Objektart back in the builder, or leave these Objekte as they are.',
        ),
      ),
    };
  const changes = diff(before, after).map((c): PlannedChange => {
    const affected = affectedCount(db, c, from);
    return affected === undefined ? c : { ...c, affected };
  });
  return { ok: true, plan: { from, to, pinned, types, diff: changes } };
}

/** A refused run: the transaction rolls back, and the move answers with this as a problem. */
class MoveRefused extends Error {}

const chunks = <T>(list: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** The ids a move touches among the features pinned to `from`, in id order. Read before the unpin, which empties the pin. */
function selectIds(db: Db, move: MovePayload, from: number): string[] {
  const out: string[] = [];
  for (let after = ''; ;) {
    const page = featuresToMove(db, move, after, PIN_BATCH_SIZE, from);
    if (page.length === 0) return out;
    out.push(...page);
    after = page[page.length - 1] as string;
  }
}

function submit(pins: PinDeps, runs: readonly Run[], what: string): void {
  const r = pins.store.submitBatch(runs);
  if (r.outcome !== 'accepted') throw new MoveRefused(`${what} was refused: ${r.refusal.code}`);
}

/**
 * Moves the pins of version `from` to the deployed version. `mappings` answer every breaking difference that touches the
 * pinned features (`{ to }` moves the values, `{ discard }` keeps them where they are); a missing answer, an invalid
 * target or a refused run changes nothing.
 */
export function movePins(
  db: Db,
  pins: PinDeps,
  from: number,
  mappings: Readonly<Record<string, ValueMapping>>,
): PinMoveResult {
  const planned = planPinMove(db, from);
  if (!planned.ok) return planned;
  const { to, diff: changes } = planned.plan;
  const after = loadData(db, to)?.file as TemplateFile;
  const checked = checkMappings(changes, mappings, after);
  const missing = changes
    .filter((c) => c.breaking && (c.affected ?? 0) > 0 && mappings[c.path] === undefined)
    .map((c) =>
      problem(
        c.path,
        'schema_invalid',
        `"${c.path}" holds values of ${c.affected ?? 0} pinned Objekte and needs an answer: move them or discard them.`,
        `„${c.path}“ enthält Werte von ${c.affected ?? 0} festgehaltenen Objekten und braucht eine Antwort: verschieben oder verwerfen.`,
        'Send a mapping for this path.',
      ),
    );
  if (checked.problems.length + missing.length > 0)
    return { ok: false, problems: [...checked.problems, ...missing] };

  try {
    return db.transaction((): PinMoveResult => {
      const planOf = checked.moves.map((m) => ({ move: m.payload, ids: selectIds(db, m.payload, from) }));
      let unpinned = 0;
      const select = db.prepare<{ id: string }>(
        'SELECT id FROM features WHERE pinned_version = ? AND id > ? ORDER BY id LIMIT ?',
      );
      for (let after = ''; ;) {
        const ids = select.all(from, after, PIN_BATCH_SIZE).map((r) => r.id);
        if (ids.length === 0) break;
        const runs: Run[] = ids.map((id) => ({
          id: pins.ids.runId(),
          task: PIN_TASK as Key,
          actor: SYSTEM_ACTOR,
          configVersion: to,
          featureId: id as FeatureId,
          input: { version: null },
        }));
        submit(pins, runs, `unpinning from version ${from}`);
        unpinned += ids.length;
        after = ids[ids.length - 1] as string;
      }
      let moved = 0;
      for (const { move, ids } of planOf) {
        for (const batch of chunks(ids, PIN_BATCH_SIZE)) {
          const runs: Run[] = batch.map((id) => ({
            id: pins.ids.runId(),
            task: MOVE_TASK as Key,
            actor: SYSTEM_ACTOR,
            configVersion: to,
            featureId: id as FeatureId,
            input: inputOf(move),
          }));
          submit(pins, runs, 'moving the values');
          moved += batch.length;
        }
      }
      return { ok: true, from, to, unpinned, moved };
    });
  } catch (e) {
    if (!(e instanceof MoveRefused)) throw e;
    return {
      ok: false,
      problems: [
        problem(
          versionPath(from),
          'schema_invalid',
          `The move was refused and nothing changed: ${e.message}.`,
          `Das Verschieben wurde abgelehnt, es hat sich nichts geändert: ${e.message}.`,
          'Check the mappings against the deployed version.',
        ),
      ],
    };
  }
}
