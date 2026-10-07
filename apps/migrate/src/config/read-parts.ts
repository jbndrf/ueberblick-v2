/**
 * Small readers of the v3 export: conditions, effects and triggers, and the v3 key names (the only
 * place, apart from `read.ts`, that spells them; the lines carry the glossary-lint marker on purpose).
 */
import type { Cond, Effect, Rec, Trigger } from './model';

export class V3ExportError extends Error {}

/** v3 key names that the glossary bans in v4 code. */
export const K = {
  props: 'field_defs', // glossary-lint-ignore
  propId: 'field_def_id', // glossary-lint-ignore
  otherPropId: 'other_field_def_id', // glossary-lint-ignore
  propIds: 'field_def_ids', // glossary-lint-ignore
  rules: 'automations', // glossary-lint-ignore
  toolRule: 'automation', // glossary-lint-ignore
} as const;

export const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
export const rec = (x: unknown): Rec => (isRec(x) ? x : {});
export const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const str = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
export const num = (x: unknown): number | undefined => (typeof x === 'number' ? x : undefined);
export const strs = (x: unknown): string[] => arr(x).filter((v): v is string => typeof v === 'string');

/** `@role/inspector` -> `inspector`; a plain key stays. */
export function unref(x: unknown): string {
  const s = str(x) ?? '';
  const m = /^@[a-z]+\/(.+)$/.exec(s);
  return m ? (m[1] as string) : s;
}

export function readCond(x: unknown): Cond {
  if (Array.isArray(x)) return { kind: 'all', items: x.map(readCond) };
  if (!isRec(x)) return { kind: 'unknown', label: 'not an object' };
  if (Array.isArray(x['all'])) return { kind: 'all', items: x['all'].map(readCond) };
  if (Array.isArray(x['any'])) return { kind: 'any', items: x['any'].map(readCond) };
  if ('not' in x) return { kind: 'not', item: readCond(x['not']) };
  const kind = str(x['kind']) ?? (K.propId in x ? 'field' : undefined);
  const op = str(x['op']) ?? 'equals';
  switch (kind) {
    case 'field': {
      const c: Cond = { kind: 'field', prop: unref(x[K.propId]), op };
      if (x['value'] !== undefined) c.value = String(x['value']);
      const aggregate = str(x['aggregate']);
      if (aggregate) c.aggregate = aggregate;
      const valueType = str(x['value_type']);
      if (valueType) c.valueType = valueType;
      return c;
    }
    case 'field_to_field':
      return { kind, prop: unref(x[K.propId]), op, other: unref(x[K.otherPropId]) };
    case 'stage':
      return { kind, op, stages: strs(x['stage_keys']) };
    case 'role':
      return { kind, roles: strs(x['role_ids']).map(unref) };
    case 'ownership':
      return { kind, value: str(x['value']) ?? 'any' };
    case 'instance_status':
      return { kind, status: str(x['status']) ?? 'active' };
    case 'related': {
      const c: Cond = { kind, via: unref(x['via']) };
      const q = str(x['quantifier']);
      if (q) c.quantifier = q;
      if (x['condition'] !== undefined) c.condition = readCond(x['condition']);
      return c;
    }
    default:
      return { kind: 'unknown', label: `condition kind ${String(kind)}` };
  }
}

export function readEffect(x: unknown): Effect {
  const e = rec(x);
  const kind = str(e['effect']);
  switch (kind) {
    case 'transition':
      return { kind, to: str(e['to']) ?? '' };
    case 'snapshot':
      return { kind };
    case 'create_instance': {
      const out: Effect = { kind };
      if (e['workflow']) out.workflow = unref(e['workflow']);
      if (e['into_field']) out.intoProp = unref(e['into_field']);
      if (e['geometry']) out.geometry = String(e['geometry']);
      return out;
    }
    case 'set_field': {
      const out: Effect = { kind, prop: unref(e[K.propId]) };
      if (e['value'] !== undefined) out.value = String(e['value']);
      if (e['expression'] !== undefined) out.expression = String(e['expression']);
      return out;
    }
    case 'clear_field':
      return { kind, prop: unref(e[K.propId]) };
    case 'set_instance_status':
      return { kind, status: str(e['status']) ?? 'active' };
    case 'compute':
      return { kind, prop: unref(e[K.propId]), expression: str(e['expression']) ?? '' };
    default:
      return { kind: 'unknown', label: `effect ${String(kind)}` };
  }
}

/** A trigger in the rich (`type`) shape or in the id-based `trigger_type` + `trigger_config` shape. */
export function readTrigger(type: unknown, cfg: Rec): Trigger {
  const kind = str(type);
  const stage = (v: unknown): string | undefined => (v ? unref(v) : undefined);
  const opt = <T extends object>(o: T, extra: Record<string, unknown>): T => {
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) (o as Rec)[k] = v;
    return o;
  };
  switch (kind) {
    case 'on_transition':
      return opt<Trigger>(
        { kind },
        {
          from: stage(cfg['from_stage_key'] ?? cfg['from_stage_id']),
          to: stage(cfg['to_stage_key'] ?? cfg['to_stage_id']),
        },
      );
    case 'on_field_change': {
      const props = arr(cfg[K.propIds]).length
        ? strs(cfg[K.propIds]).map(unref)
        : cfg['field_key']
          ? [unref(cfg['field_key'])]
          : [];
      return opt<Trigger>({ kind, props }, { stage: stage(cfg['in_stage_key'] ?? cfg['stage_id']) });
    }
    case 'on_create':
      return { kind };
    case 'scheduled':
      return opt<Trigger>(
        { kind, cron: str(cfg['cron']) ?? '' },
        {
          stage: stage(cfg['in_stage_key'] ?? cfg['target_stage_id']),
          inactiveDays: num(cfg['if_inactive_days'] ?? cfg['inactive_days']) || undefined,
        },
      );
    case 'elapsed':
      return { kind, after: str(cfg['after']) ?? '', since: str(cfg['since']) ?? '' };
    case 'when':
      return { kind, cond: readCond(cfg['conditions']) };
    case 'on_task_run':
      return { kind, task: str(cfg['task_key']) ?? '' };
    case 'on_task_outcome':
      return opt<Trigger>({ kind, task: str(cfg['task_key']) ?? '' }, { outcome: str(cfg['outcome']) });
    default:
      return { kind: 'unknown', label: `trigger ${String(kind)}` };
  }
}
