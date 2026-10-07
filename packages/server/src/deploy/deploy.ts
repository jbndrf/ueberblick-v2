/**
 * deploy / plan (docs/05, docs/08): compile a project file, diff it against the deployed version,
 * store an immutable `config_versions` row and reconcile the expression indexes, all in one
 * transaction. A blocked deploy writes nothing.
 */
import {
  compile,
  NO_ASSETS,
  diff,
  merge,
  problemsFromMergeIssues,
  serialize,
  type CompiledConfig,
  type OverlayFile,
  type Problem,
  type TemplateFile,
} from '@ueberblick/core';
import { timerWarnings } from '../timers/warnings';
import type { Db } from '../db/driver';
import type {
  DeployDeps,
  DeployInput,
  DeployResult,
  PlanResult,
  PlannedChange,
  ValueMapping,
  VersionChoices,
  VersionPlan,
} from './contract';
import { affectedCount } from './move-select';
import { checkMappings, recomputeMoves, recordMoves } from './moves';
import { changedTypes, checkChoices, typesToKeep, versionPlans, writePins } from './pins';
import { reconcileIndexes } from './index-ddl';
import { deployedVersion, loadData, versionByHash } from './versions';

interface Prepared {
  readonly config: CompiledConfig;
  readonly template: TemplateFile['template'];
  readonly overlay: OverlayFile | undefined;
}

const isOverlay = (f: DeployInput): f is OverlayFile => 'extends' in f && !('template' in f);

/** Resolves the effective file and compiles it; problems block the deploy. */
function prepare(file: DeployInput, deps: DeployDeps): Prepared | { readonly problems: readonly Problem[] } {
  let effective: TemplateFile;
  let overlay: OverlayFile | undefined;
  let template: TemplateFile;
  if (isOverlay(file)) {
    const found = deps.templates?.resolve(file.extends);
    if (found === undefined)
      return {
        problems: [
          {
            path: 'extends',
            code: 'dangling_reference',
            message: `The template ${file.extends} is not available.`,
            hint: 'Publish that template version first, or change `extends` to one that exists.',
          },
        ],
      };
    const merged = merge(found, file);
    if (merged.issues.length > 0) return { problems: problemsFromMergeIssues(merged.issues) };
    template = found;
    effective = merged.file;
    overlay = file;
  } else {
    template = effective = file;
  }
  const r = compile(effective, { assets: NO_ASSETS });
  if (!r.ok) return { problems: r.problems };
  return { config: r.config, template: template.template, overlay };
}

/** The file of the deployed version, if there is one. */
function deployedFile(db: Db): TemplateFile | undefined {
  const cur = deployedVersion(db);
  return cur && loadData(db, cur.version)?.file;
}

/** What deploying `file` would change relative to the deployed version. */
function diffAgainstDeployed(db: Db, file: TemplateFile): readonly PlannedChange[] {
  const before = deployedFile(db);
  return diff(before ?? { schema: file.schema, template: file.template }, file).map((e) => {
    const affected = affectedCount(db, e);
    return affected === undefined ? e : { ...e, affected };
  });
}

/** The per-type counts of the choice and the problems of the request's choices (WP-317); `changes` is the deploy's diff. */
function versionChoice(
  db: Db,
  file: TemplateFile,
  changes: readonly PlannedChange[],
  choices: VersionChoices,
): { readonly plans: readonly VersionPlan[]; readonly problems: readonly Problem[] } {
  const before = deployedFile(db);
  const changed = changedTypes(before, file, changes);
  const plans = before === undefined ? [] : versionPlans(db, changed);
  const known = (t: string): boolean => before?.types?.[t] !== undefined || file.types?.[t] !== undefined;
  return { plans, problems: checkChoices(choices, plans, changed, known) };
}

/** Dry run: compiles and diffs against the deployed version, writes nothing. */
export function plan(db: Db, file: DeployInput, deps: DeployDeps, choices: VersionChoices = {}): PlanResult {
  const p = prepare(file, deps);
  if ('problems' in p) return { ok: false, problems: p.problems };
  const known = versionByHash(db, p.config.hash);
  const diffed = known?.status === 'deployed' ? [] : diffAgainstDeployed(db, p.config.file);
  const v = versionChoice(db, p.config.file, diffed, choices);
  if (v.problems.length > 0) return { ok: false, problems: v.problems };
  return {
    ok: true,
    warnings: timerWarnings(p.config, deps.clock.now()),
    diff: diffed,
    versions: v.plans,
    ...(known ? { version: known.version } : {}),
  };
}

export function deploy(
  db: Db,
  file: DeployInput,
  by: string,
  deps: DeployDeps,
  mappings: Readonly<Record<string, ValueMapping>> = {},
  choices: VersionChoices = {},
): DeployResult {
  const p = prepare(file, deps);
  if ('problems' in p) return { ok: false, problems: p.problems };
  const { config, template, overlay } = p;
  return db.transaction((): DeployResult => {
    const known = versionByHash(db, config.hash);
    const warnings = timerWarnings(config, deps.clock.now());
    if (known?.status === 'deployed') {
      const same = versionChoice(db, config.file, [], choices);
      if (same.problems.length > 0) return { ok: false, problems: same.problems };
      return { ok: true, version: known.version, created: false, diff: [], moves: 0, pinned: 0, warnings };
    }
    const recomputes = recomputeMoves(deployedFile(db), config.file);
    const changes = diffAgainstDeployed(db, config.file);
    const checked = checkMappings(changes, mappings, config.file);
    if (checked.problems.length > 0) return { ok: false, problems: checked.problems };
    const v = versionChoice(db, config.file, changes, choices);
    if (v.problems.length > 0) return { ok: false, problems: v.problems };
    // The pins are written while the previous version is still the deployed one: a pinned feature never floats on the new one.
    const keep = typesToKeep(v.plans, choices);
    const previous = deployedVersion(db);
    let pinned = 0;
    if (keep.length > 0) {
      if (deps.pins === undefined || previous === undefined)
        throw new Error('a `keep` choice needs `deps.pins` and a deployed version');
      pinned = writePins(db, deps.pins, keep, previous.version);
    }
    db.prepare("UPDATE config_versions SET status = 'retired' WHERE status = 'deployed'").run();
    let version: number;
    if (known) {
      db.prepare("UPDATE config_versions SET status = 'deployed' WHERE version = ?").run(known.version);
      version = known.version;
    } else {
      const res = db
        .prepare(
          `INSERT INTO config_versions (schema, template, template_version, overlay, compiled, hash, status, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'deployed', ?, ?)`,
        )
        .run(
          config.file.schema,
          template.key,
          template.version,
          JSON.stringify(overlay ?? {}),
          JSON.stringify(serialize(config)),
          config.hash,
          by,
          deps.clock.now(),
        );
      version = Number(res.lastInsertRowid);
    }
    reconcileIndexes(db, config.file);
    recordMoves(db, version, [...checked.moves, ...recomputes]);
    return {
      ok: true,
      version,
      created: known === undefined,
      diff: changes,
      moves: checked.moves.length + recomputes.length,
      pinned,
      warnings,
    };
  });
}
