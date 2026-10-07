/**
 * The v3 eval-core corpus (`fixtures/v3/eval-core.fixtures.json`) as a synthetic v3 project plus recorded
 * runs: every case becomes one run of a task whose only condition is the case's condition. v3's tri-state result
 * is the recorded outcome (`pass` is accepted; `fail` and `invalid` are refused, v3 fails closed).
 */
import { K } from '../config/read-parts';
import type { V3Run, V3Value } from './types';

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

export interface EvalCase {
  readonly name: string;
  readonly condition: unknown;
  readonly ctx: Rec;
  readonly expect: string;
}

export interface EvalCoreScenario {
  /** A v3 project definition (format 1) with the workflow `w`, its task `t` and the child workflow `child`. */
  readonly v3Export: unknown;
  readonly runs: V3Run[];
}

interface Use {
  /** Field key to the v3 field kind that the clauses need. */
  readonly kinds: Map<string, string>;
  readonly stages: Set<string>;
  readonly roles: Set<string>;
  readonly related: Set<string>;
}

const NUMERIC_OPS = ['gt', 'gte', 'lt', 'lte'];
const isDateOp = (c: Rec): boolean =>
  c['value_type'] === 'date' || c['op'] === 'older_than_days' || c['op'] === 'newer_than_days';
const unref = (s: unknown): string => String(s).replace(/^@[a-z]+\//, '');

/** Collects what the clauses need from the project: field kinds, stages, roles and related fields. */
function walk(c: unknown, scope: Use, child: Use): void {
  if (Array.isArray(c)) return c.forEach((x) => walk(x, scope, child));
  if (!isRec(c)) return;
  if (Array.isArray(c['all'])) return c['all'].forEach((x) => walk(x, scope, child));
  if (Array.isArray(c['any'])) return c['any'].forEach((x) => walk(x, scope, child));
  if ('not' in c) return walk(c['not'], scope, child);
  const kind = c['kind'] ?? (K.propId in c ? 'field' : undefined);
  if (kind === 'field' || kind === 'field_to_field') {
    const id = unref(c[K.propId]);
    if (id.startsWith('$')) return;
    const op = String(c['op'] ?? 'equals');
    const t = isDateOp(c)
      ? 'date'
      : NUMERIC_OPS.includes(op)
        ? 'number'
        : op.includes('includes')
          ? 'multiple_choice'
          : 'short_text';
    scope.kinds.set(id, scope.kinds.get(id) === 'date' ? 'date' : t);
    if (kind === 'field_to_field') scope.kinds.set(unref(c[K.otherPropId]), 'number');
  } else if (kind === 'stage') {
    for (const s of (c['stage_keys'] as string[] | undefined) ?? []) scope.stages.add(s);
  } else if (kind === 'role') {
    for (const r of (c['role_ids'] as string[] | undefined) ?? []) scope.roles.add(unref(r));
  } else if (kind === 'related') {
    scope.related.add(unref(c['via']));
    walk(c['condition'], child, child);
  }
}

const use = (): Use => ({ kinds: new Map(), stages: new Set(), roles: new Set(), related: new Set() });

const fieldRecord = (key: string, kind: string, options: string[]): Rec => ({
  key,
  record: {
    field_label: key,
    field_type: kind,
    ...(kind === 'multiple_choice' ? { field_options: { options } } : {}),
    ...(kind === 'date' ? { field_options: { date_mode: 'date' } } : {}),
  },
});

const stages = (keys: Set<string>): Rec[] => [
  { key: 's0', name: 's0', type: 'start' },
  ...[...keys].filter((k) => k !== 's0').map((k) => ({ key: k, name: k, type: 'intermediate' })),
];

/** Latest stored value of a v3 history (the last one). */
const latest = (list: unknown): V3Value | undefined => {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const v = list[list.length - 1] as unknown;
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null
    ? v
    : undefined;
};

const valuesOf = (m: unknown): Record<string, V3Value> => {
  const out: Record<string, V3Value> = {};
  if (!isRec(m)) return out;
  for (const [k, list] of Object.entries(m)) {
    const v = latest(list);
    if (v !== undefined && !k.startsWith('$')) out[k] = v;
  }
  return out;
};

/**
 * Differences that are expected on the corpus, by what v3 did. Each is a fact about v3, not a property of a
 * project, so the notes live with the adapter; a run shows one only when v4 really differs.
 */
export function knownFor(c: EvalCase): string | undefined {
  if (c.expect === 'invalid') {
    return "v3 result was 'invalid' because the context lacked a value (v3 fails closed); a v4 feature always has a stage, a status and a creator, so this state cannot occur";
  }
  if (c.name.includes('NFD')) {
    return 'v3 compared text NFC-normalised; v4 compares code points. Follow-up: the data conversion (WP-301) writes text as NFC, and rule literals are written as NFC';
  }
  return undefined;
}

export function evalCoreScenario(cases: readonly EvalCase[]): EvalCoreScenario {
  const parent = use();
  const child = use();
  for (const c of cases) walk(c.condition, parent, child);
  for (const c of cases) {
    if (typeof c.ctx['currentStageKey'] === 'string') parent.stages.add(c.ctx['currentStageKey']);
    for (const r of (c.ctx['participantRoleIds'] as string[] | undefined) ?? []) parent.roles.add(r);
    for (const list of Object.values(isRec(c.ctx['related']) ? c.ctx['related'] : {})) {
      for (const r of (list as Rec[] | undefined) ?? []) {
        if (typeof r['currentStageKey'] === 'string') child.stages.add(r['currentStageKey']);
        for (const f of Object.keys(isRec(r['values']) ? r['values'] : {}))
          child.kinds.set(f, child.kinds.get(f) ?? 'short_text');
      }
    }
  }
  const optionsOf = (field: string): string[] => {
    const seen = new Set<string>();
    for (const c of cases) {
      for (const v of (isRec(c.ctx['values'])
        ? (c.ctx['values'][field] as unknown[] | undefined)
        : undefined) ?? []) {
        if (typeof v === 'string' && v.startsWith('['))
          for (const o of JSON.parse(v) as string[]) seen.add(o);
      }
      const cond = JSON.stringify(c.condition);
      if (cond.includes(field)) for (const m of cond.matchAll(/"value":"([^"]+)"/g)) seen.add(m[1] as string);
    }
    return [...seen];
  };
  const via = [...parent.related].map((v) => ({ key: v, kind: 'instance_reference' }));
  const workflow = (key: string, u: Use, extra: Rec[], tasks: Rec[]): Rec => ({
    key,
    record: { name: key, workflow_type: 'incident', geometry_type: 'point', is_active: true, sort_order: 0 },
    [K.props]: [
      ...[...u.kinds].map(([f, kind]) =>
        fieldRecord(f, kind, kind === 'multiple_choice' ? optionsOf(f) : []),
      ),
      ...extra,
    ],
    document: { version: 0, stages: stages(u.stages), edges: [], tasks },
  });
  const referenceField = (key: string): Rec => ({
    key,
    record: {
      field_label: key,
      field_type: 'instance_reference',
      field_options: {
        target_workflow_id: '@workflow/child',
        multiplicity: 'many',
        relation_kind: 'child',
      },
    },
  });
  const task = (condition: unknown): Rec => ({
    key: 't',
    name: 't',
    activation: { mode: 'available' },
    conditions:
      condition === null || condition === undefined ? [] : Array.isArray(condition) ? condition : [condition],
    tools: [],
    effects: [],
  });
  const v3Export = {
    format: 1,
    version: 0,
    source: { name: 'Eval core', description: '' },
    settings: {},
    // `open`: every actor holds it, so a task without a role clause (open to all in v3) is open to them in v4 (`who`)
    roles: [...parent.roles, 'open'].map((r) => ({ key: r, record: { name: r } })),
    custom_tables: [],
    map_layers: [],
    info_pages: [],
    // every case is a task of its own, so the conditions do not meet in one task
    workflows: [
      workflow(
        'w',
        parent,
        via.map((v) => referenceField(v.key)),
        cases.map((c, i) => ({ ...task(c.condition), key: `t${i}` })),
      ),
      workflow('child', child, [], []),
    ],
  };
  const runs = cases.map((c, i): V3Run => {
    const related: Record<string, { stage?: string; status?: string; values?: Record<string, V3Value> }[]> =
      {};
    for (const [via, list] of Object.entries(isRec(c.ctx['related']) ? c.ctx['related'] : {})) {
      related[via] = ((list as Rec[]) ?? []).map((r) => ({
        ...(typeof r['currentStageKey'] === 'string' ? { stage: r['currentStageKey'] } : {}),
        ...(typeof r['instanceStatus'] === 'string' ? { status: r['instanceStatus'] } : {}),
        values: valuesOf(r['values']),
      }));
    }
    const ctx = c.ctx;
    return {
      id: c.name,
      workflow: 'w',
      task: `t${i}`,
      actor: {
        id: typeof ctx['participantId'] === 'string' ? ctx['participantId'] : 'p0',
        roles: [...((ctx['participantRoleIds'] as string[] | undefined) ?? []), 'open'],
      },
      instance: {
        stage: typeof ctx['currentStageKey'] === 'string' ? ctx['currentStageKey'] : 's0',
        ...(typeof ctx['instanceStatus'] === 'string' ? { status: ctx['instanceStatus'] } : {}),
        ...(typeof ctx['instanceCreatedBy'] === 'string' ? { createdBy: ctx['instanceCreatedBy'] } : {}),
        values: valuesOf(ctx['values']),
        related,
      },
      ...(typeof ctx['now'] === 'number' ? { now: ctx['now'] } : {}),
      recorded: {
        outcome: c.expect === 'pass' ? 'accepted' : 'refused',
        reason: `v3 result: ${c.expect}`,
        ...(knownFor(c) !== undefined ? { known: knownFor(c) as string } : {}),
      },
    };
  });
  return { v3Export, runs };
}
