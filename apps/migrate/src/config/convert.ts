/**
 * convertConfig: a v3 project definition to a v4 template plus overlay, with a report that accounts
 * for every v3 item (docs/user/admin/migration-from-v3.md).
 */
import {
  compile,
  NO_ASSETS,
  merge,
  parseProjectFile,
  problemsFromMergeIssues,
  type OverlayFile,
  type Problem,
  type PropertyTypeKey,
  type Task,
  type TemplateFile,
} from '@ueberblick/core';
import { buildRoles, buildViews, DEFAULT_CAMERA, MAP_VIEW, reportUnmodelled } from './app';
import { createProperties, createRelations, createShells, type Entry } from './build';
import type { Ctx, TypeInfo } from './ctx';
import { finishTypes } from './finish';
import { addImportTasks, type ImportTarget, type ImportTasks } from './import';
import { KeySpace, slug } from './keys';
import { addErasure, type PersonalMark } from './personal';
import { readProject } from './read';
import { Report, type ConversionReport } from './report';
import { convertRuleSet, convertTriggeredTask, type RuleOut } from './rules';
import { convertAvailable } from './tasks';

export interface TypeMapping {
  /** The v4 feature type key. */
  readonly type: string;
  readonly geometry?: string;
  readonly stage?: { readonly property: string; readonly options: Record<string, string> };
  readonly creator?: string;
  readonly lifecycle?: string;
  readonly properties: Record<
    string,
    {
      property: string;
      type: PropertyTypeKey;
      options?: Record<string, string>;
      /** A many-valued reference: `property` is a relation of cardinality many; features of `inverse.type` point back through `inverse.property`. */
      inverse?: { type: string; property: string };
    }
  >;
}

/** Where every v3 key went; the data conversion (WP-301) reads it. */
export interface Mapping {
  readonly types: Record<string, TypeMapping>;
  readonly tables: Record<string, TypeMapping>;
  readonly roles: Record<string, string>;
  readonly tasks: Record<string, string>;
}

export interface Check {
  /** True when the schema accepts both files and `compile` reports no problem. */
  readonly ok: boolean;
  readonly schemaIssues: readonly string[];
  readonly problems: readonly Problem[];
  readonly warnings: readonly Problem[];
}

export interface ConvertResult {
  readonly template: TemplateFile;
  readonly overlay: OverlayFile;
  readonly report: ConversionReport;
  readonly mapping: Mapping;
  /** The converted project (template merged with overlay) checked by the schema and `compile`. */
  readonly check: Check;
  /** The import tasks of every feature type, by v4 feature type key. */
  readonly imports: Readonly<Record<string, ImportTasks>>;
  /** The properties marked `personal`, with the reason; when any, the template has an erasure task (WP-172). */
  readonly personal: readonly PersonalMark[];
  /** With `target: 'import'` and a passing `check`: the project to import into. */
  readonly target?: ImportTarget;
}

const typeMapping = (t: TypeInfo): TypeMapping => ({
  type: t.key,
  ...(t.geomKey ? { geometry: t.geomKey } : {}),
  ...(t.stageOptions.size > 0
    ? { stage: { property: t.stageKey, options: Object.fromEntries(t.stageOptions) } }
    : {}),
  ...(t.needsCreator ? { creator: t.creatorKey } : {}),
  ...(t.statuses.size > 0 ? { lifecycle: t.lifecycleKey } : {}),
  properties: Object.fromEntries(
    [...t.props.values()].map((p) => [
      p.v3Key,
      {
        property: p.key,
        type: p.type,
        ...(p.options.size > 0 ? { options: Object.fromEntries(p.options) } : {}),
        ...(p.relation ? { inverse: { ...p.relation } } : {}),
      },
    ]),
  ),
});

/** Problem codes that `compile` reports as warnings; a failed compile lists them together with the errors. */
const WARNING_CODES: readonly string[] = ['dead_option', 'rule_cycle', 'never_available'];

function runCheck(template: TemplateFile, overlay: OverlayFile, imports: ReadonlySet<string>): Check {
  const schemaIssues = [template, overlay].flatMap((f) => {
    const r = parseProjectFile(f);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  });
  const merged = merge(template, overlay);
  const mergeProblems = problemsFromMergeIssues(merged.issues);
  const compiled = compile(merged.file, { assets: NO_ASSETS });
  const failed = compiled.ok ? [] : compiled.problems;
  const problems = [...mergeProblems, ...failed.filter((p) => !WARNING_CODES.includes(p.code))];
  // The import tasks are not v3 items and their forms write every property, which would hide dead options and
  // raise write warnings for the actor kind `import`. The warnings come from the project without them.
  const own = structuredClone(merged.file) as TemplateFile;
  for (const t of imports) delete own.tasks?.[t];
  const plain = compile(own, { assets: NO_ASSETS });
  const warnings = plain.ok ? plain.warnings : plain.problems.filter((p) => WARNING_CODES.includes(p.code));
  return { ok: schemaIssues.length === 0 && problems.length === 0, schemaIssues, problems, warnings };
}

export interface ConvertOptions {
  /**
   * `import`: also produce the project to import into (`ConvertResult.target`), and leave the rules out of the
   * template, so v3 rules do not run again on historical runs. Deploy the full project after the import.
   */
  readonly target?: 'import';
}

export function convertConfig(v3Export: unknown, options: ConvertOptions = {}): ConvertResult {
  const project = readProject(v3Export);
  const report = new Report(project.inventory);

  const roleSpace = new KeySpace();
  const roleKeys = new Map<string, string>(project.roles.map((r) => [r.key, roleSpace.take(r.key)]));
  const types = new Map<string, TypeInfo>();
  const tables = new Map<string, TypeInfo>();
  const ctx: Ctx = {
    report,
    types,
    tables,
    byKey: (key) => [...types.values(), ...tables.values()].find((t) => t.key === key),
    roleKeys,
    taskKeys: new Map(),
    toolsUsed: new Set(),
    role: (v3) => roleKeys.get(v3) ?? slug(v3),
    knownRole: (v3) => roleKeys.get(v3),
  };

  const typeSpace = new KeySpace();
  const entries: Entry[] = createShells(project, ctx, typeSpace);
  createProperties(entries, project, ctx);
  createRelations(entries, project, ctx);
  for (const t of project.tables) {
    report.mapped(t.id, `types.${tables.get(t.key)?.key}`);
    report.columns(t.id, t.record, {
      name: ['mapped', undefined, 'the label of the lookup feature type'],
      sort_order: ['mapped', undefined, 'the order of feature types'],
    });
  }

  const taskSpace = new KeySpace();
  const ruleSpace = new KeySpace();
  const out: RuleOut = { tasks: {} };
  for (const e of entries) {
    for (const t of e.src?.tasks ?? []) ctx.taskKeys.set(`${e.info.v3Key}/${t.key}`, taskSpace.take(t.key));
  }
  const tasks: Record<string, Task> = out.tasks;
  for (const e of entries) {
    for (const t of e.src?.tasks ?? []) {
      if (t.triggered) continue;
      const c = convertAvailable(t, e.info, ctx, taskSpace);
      tasks[c.key] = c.task;
      Object.assign(tasks, c.extra);
    }
  }
  const keys = { tasks: taskSpace, rules: ruleSpace };
  for (const e of entries) {
    for (const t of e.src?.tasks ?? []) if (t.triggered) convertTriggeredTask(t, e.info, ctx, keys, out);
    for (const r of e.src?.rules ?? []) convertRuleSet(r, e.info, ctx, keys, out);
  }
  for (const e of entries) {
    if (!e.info.needsCreator) continue;
    for (const k of e.info.entryTasks) {
      const task = tasks[k];
      if (task) task.then = [{ set: { [e.info.creatorKey]: 'actor.id' } }, ...(task.then ?? [])];
    }
  }

  // `import`: the automatic actions stay out of the template, so history does not fire them again.
  if (options.target === 'import') for (const t of Object.values(tasks)) delete t.auto;
  const finished = finishTypes(entries, ctx);
  // Every feature type can be imported (WP-301), by the actor kind `import` only.
  const imports = addImportTasks(tasks, finished, taskSpace);
  // Erasure needs `personal` flags and a task with a `redact` step (A-021); without personal data there is nothing to erase.
  const personal: PersonalMark[] = entries.flatMap((e) =>
    [...e.info.props.values()].flatMap((p) =>
      p.personalReason === undefined
        ? []
        : [{ target: `types.${e.info.key}.properties.${p.key}`, reason: p.personalReason }],
    ),
  );
  if (personal.length > 0) addErasure(tasks, finished, typeSpace, taskSpace);
  const viewSpace = new KeySpace();
  const views = buildViews(project, entries, ctx, viewSpace);
  const roles = buildRoles(project, entries, ctx, views);
  reportUnmodelled(project, ctx);

  const templateKey = slug(project.name);
  const template: TemplateFile = {
    schema: 'ueberblick/1',
    template: { key: templateKey, version: '1.0.0', label: views.label },
    roles,
    types: finished,
    tasks,
    views: views.views,
    ...(ctx.toolsUsed.size > 0 ? { tools: Object.fromEntries([...ctx.toolsUsed].map((t) => [t, {}])) } : {}),
  };
  const overlay: OverlayFile = { schema: 'ueberblick/1', extends: `${templateKey}@1` };
  const cam = views.camera;
  const custom =
    cam.zoom !== DEFAULT_CAMERA.zoom ||
    cam.center[0] !== DEFAULT_CAMERA.center[0] ||
    cam.center[1] !== DEFAULT_CAMERA.center[1];
  if (custom && views.views[MAP_VIEW]) {
    overlay.override = { [`views.${MAP_VIEW}.camera`]: { center: [...cam.center], zoom: cam.zoom } };
  }

  const mapping: Mapping = {
    types: Object.fromEntries([...types].map(([k, t]) => [k, typeMapping(t)])),
    tables: Object.fromEntries([...tables].map(([k, t]) => [k, typeMapping(t)])),
    roles: Object.fromEntries(roleKeys),
    tasks: Object.fromEntries(ctx.taskKeys),
  };
  const check = runCheck(
    template,
    overlay,
    new Set(Object.values(imports).flatMap((t) => [t.create, t.update])),
  );
  const result = {
    template,
    overlay,
    report: report.finish(project.inventory, check.warnings),
    mapping,
    check,
    imports,
    personal,
  };
  if (options.target !== 'import' || !check.ok) return result;
  const merged = merge(template, overlay).file;
  const compiled = compile(merged, { assets: NO_ASSETS });
  return compiled.ok
    ? { ...result, target: { file: merged, config: compiled.config, tasks: imports } }
    : result;
}
