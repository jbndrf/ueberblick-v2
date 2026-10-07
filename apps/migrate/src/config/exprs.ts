/**
 * v3 conditions, values and formulas as rule-language expressions (docs/06). A clause that cannot
 * be translated becomes `false` (fail closed) and a note says so; nothing is silently widened.
 */
import type { Cond } from './model';
import { valueProp, type Note, type PropInfo, type TypeInfo } from './ctx';
import { slug } from './keys';

/** Where an expression reads values: `self` (or `self.<relation>`), and the form's own values. */
export interface ExprEnv {
  readonly type: TypeInfo;
  readonly base: string;
  /** In a form: v3 keys of the fields that the form has (they read `form.<key>`). */
  readonly form?: ReadonlySet<string>;
  /** The expression runs where no feature exists yet (creating tasks): `self` is not available. */
  readonly noSelf?: boolean;
  readonly role: (v3: string) => string;
  /** A feature type by its v4 key (for conditions that follow a reference). */
  readonly types: (key: string) => TypeInfo | undefined;
}

/** The actor holds any of these (already quoted) role keys: the model has `actor.roles` only. */
export const hasRole = (quoted: string[]): string =>
  quoted.length === 1 ? `${quoted[0]} in actor.roles` : quoted.map((r) => `${r} in actor.roles`).join(' || ');

export const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const SYMBOL: Record<string, string> = {
  equals: '==',
  not_equals: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};
const isTime = (t: PropInfo): boolean => t.type === 'date' || t.type === 'datetime';
export const isNumeric = (t: PropInfo): boolean => t.type === 'number' || t.type === 'integer';
/** What values of a property can be compared with: numbers, times, strings; anything else only for equality. */
export const compareKind = (t: PropInfo): string =>
  isNumeric(t)
    ? 'number'
    : isTime(t)
      ? 'time'
      : t.type === 'boolean'
        ? 'boolean'
        : ['text', 'select', 'participant', 'file'].includes(t.type)
          ? 'string'
          : t.type === 'reference'
            ? `reference:${t.to ?? ''}`
            : t.type;
const isOptions = (t: PropInfo): boolean => t.type === 'select' || t.type === 'multiselect';

/** A v3 stored value as a literal of the property's type; `undefined` when it does not fit. */
export function literal(pi: PropInfo, v: string, note: Note, strictOption = false): string | undefined {
  if (pi.type === 'reference') {
    note('dropped', `a fixed value cannot be a reference to another feature (${pi.v3Key})`);
    return undefined;
  }
  if (isOptions(pi)) {
    const key = pi.options.get(v);
    if (key !== undefined) return quote(key);
    if (strictOption) {
      note('dropped', `"${v}" is not an option of ${pi.v3Key}`);
      return undefined;
    }
    note('approximated', `"${v}" is not an option of ${pi.v3Key}; compared as written`);
    return quote(slug(v, 'v'));
  }
  if (isNumeric(pi)) {
    if (v.trim() !== '' && Number.isFinite(Number(v))) return String(Number(v));
    note('dropped', `"${v}" is not a number, but ${pi.v3Key} is one`);
    return undefined;
  }
  if (pi.type === 'boolean') return v === 'true' ? 'true' : 'false';
  if (isTime(pi)) return `date(${quote(v)})`;
  return quote(v);
}

/** The expression that reads a property: `form.x` for a field of the current form, else `<base>.x`. */
export function access(pi: PropInfo, env: ExprEnv): string {
  return env.form?.has(pi.v3Key) ? `form.${pi.key}` : `${env.base}.${pi.key}`;
}

function comparison(c: Extract<Cond, { kind: 'field' }>, pi: PropInfo, env: ExprEnv, note: Note): string {
  const lhs = access(pi, env);
  const value = c.value ?? '';
  const many = pi.type === 'multiselect';
  if (c.aggregate === 'count' && env.base === 'self' && SYMBOL[c.op]) {
    return `count(${quote(pi.key)}) ${SYMBOL[c.op]} ${Number(value) || 0}`;
  }
  if (c.aggregate !== undefined && c.aggregate !== 'latest') {
    note('approximated', `aggregate "${c.aggregate}" is read as the latest value`);
  }
  const lit = (): string | undefined => literal(pi, value, note);
  switch (c.op) {
    case 'equals':
    case 'not_equals': {
      const l = lit();
      if (l === undefined) return 'false';
      if (many) return `${c.op === 'equals' ? '' : '!'}(${l} in ${lhs})`;
      return `${lhs} ${SYMBOL[c.op]} ${l}`;
    }
    case 'contains':
    case 'includes':
    case 'not_includes': {
      const neg = c.op === 'not_includes' ? '!' : '';
      if (many) {
        const l = lit();
        return l === undefined ? 'false' : `${neg}(${l} in ${lhs})`;
      }
      if (isOptions(pi)) {
        note('approximated', `"${c.op}" on a single-choice property is an equality test`);
        const l = lit();
        return l === undefined ? 'false' : `${neg ? '!(' : ''}${lhs} == ${l}${neg ? ')' : ''}`;
      }
      if (pi.type !== 'text' && pi.type !== 'participant' && pi.type !== 'file') {
        note(
          'dropped',
          `"${c.op}" needs a text or list property, but ${pi.v3Key} is of type ${pi.type}; the clause evaluates to false`,
        );
        return 'false';
      }
      // v3 matched text case-insensitively
      return `${neg}${lhs}.lower().contains(${quote(value)}.lower())`;
    }
    case 'is_empty':
    case 'is_not_empty': {
      const empty =
        pi.type === 'multiselect'
          ? `(${lhs} == null || ${lhs} == [])`
          : isOptions(pi) || pi.type === 'text' || pi.type === 'file' || pi.type === 'participant'
            ? `(${lhs} == null || ${lhs} == '')`
            : `${lhs} == null`;
      return c.op === 'is_empty' ? empty : `!(${empty})`;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (!['number', 'time', 'string'].includes(compareKind(pi))) {
        note(
          'dropped',
          `"${c.op}" cannot order ${pi.type} values (${pi.v3Key}); the clause evaluates to false`,
        );
        return 'false';
      }
      const l = c.valueType === 'text' && !isNumeric(pi) && !isTime(pi) ? quote(value) : lit();
      return l === undefined ? 'false' : `${lhs} ${SYMBOL[c.op]} ${l}`;
    }
    case 'older_than_days':
    case 'newer_than_days': {
      const n = Number(value);
      if (!isTime(pi) || !Number.isFinite(n)) {
        note('dropped', `"${c.op}" needs a date property and a number of days`);
        return 'false';
      }
      return `${lhs} ${c.op === 'older_than_days' ? '<' : '>'} today() - days(${n})`;
    }
    default:
      note('dropped', `unknown operator "${c.op}"; the clause evaluates to false`);
      return 'false';
  }
}

/** A stored v3 value as the value to write: a multi-choice property takes a list. */
export function assignment(pi: PropInfo, v: string, note: Note): string | undefined {
  const l = literal(pi, v, note, true);
  return l !== undefined && pi.type === 'multiselect' ? `[${l}]` : l;
}

const wrap = (s: string): string => (/ (&&|\|\|) |\?/.test(s) && !/^\(.*\)$/.test(s) ? `(${s})` : s);

/** Translate a condition tree over the properties of `env.type`. */
export function translate(c: Cond, env: ExprEnv, note: Note): string {
  if (
    env.noSelf &&
    c.kind !== 'all' &&
    c.kind !== 'any' &&
    c.kind !== 'not' &&
    c.kind !== 'role' &&
    c.kind !== 'unknown'
  ) {
    if (c.kind === 'stage' || c.kind === 'ownership') {
      note(
        'approximated',
        'a task that creates has no feature yet; the clause is ignored (v3 ignored it for entry tasks too)',
      );
      return 'true';
    }
    note(
      'approximated',
      'a task that creates has no feature yet, so there is no value to test; the clause evaluates to false',
    );
    return 'false';
  }
  switch (c.kind) {
    case 'all':
    case 'any': {
      const parts = c.items.map((i) => translate(i, env, note));
      const neutral = c.kind === 'all' ? 'true' : 'false';
      const kept = parts.filter((p) => p !== neutral);
      if (kept.length === 0) return neutral;
      if (kept.length === 1) return kept[0] as string;
      return kept.map(wrap).join(c.kind === 'all' ? ' && ' : ' || ');
    }
    case 'not':
      return `!(${translate(c.item, env, note)})`;
    case 'field': {
      const pi = valueProp(env.type, c.prop);
      if (!pi) {
        note('approximated', `field "${c.prop}" does not exist; the clause evaluates to false`);
        return 'false';
      }
      return comparison(c, pi, env, note);
    }
    case 'field_to_field': {
      const a = valueProp(env.type, c.prop);
      const b = valueProp(env.type, c.other);
      const sym = SYMBOL[c.op];
      if (!a || !b || !sym || compareKind(a) !== compareKind(b)) {
        note(
          'approximated',
          `cannot compare "${c.prop}" with "${c.other}" by "${c.op}"; the clause evaluates to false`,
        );
        return 'false';
      }
      if (
        c.op !== 'equals' &&
        c.op !== 'not_equals' &&
        !['number', 'time', 'string'].includes(compareKind(a))
      )
        return 'false';
      return `${access(a, env)} ${sym} ${access(b, env)}`;
    }
    case 'stage': {
      if (env.type.stageOptions.size === 0) {
        note('approximated', 'the feature type has no stages; the clause evaluates to false');
        return 'false';
      }
      const keys = c.stages.map((s) => {
        const k = env.type.stageOptions.get(s);
        if (k === undefined) note('approximated', `stage "${s}" does not exist`);
        return quote(k ?? slug(s));
      });
      const lhs = `${env.base}.${env.type.stageKey}`;
      if (keys.length === 0) return 'false';
      return keys.length === 1 ? `${lhs} == ${keys[0]}` : `${lhs} in [${keys.join(', ')}]`;
    }
    case 'role': {
      if (c.roles.length === 0) return 'true';
      const roles = c.roles.map((r) => quote(env.role(r)));
      return hasRole(roles);
    }
    case 'ownership': {
      if (c.value !== 'self') return 'true';
      env.type.needsCreator = true;
      return `${env.base}.${env.type.creatorKey} == actor.id`;
    }
    case 'instance_status':
      env.type.statuses.add(c.status);
      return `${env.base}.${env.type.lifecycleKey} == ${quote(slug(c.status, 's'))}`;
    case 'related': {
      const via = env.type.props.get(c.via);
      const target = via?.to ? env.types(via.to) : undefined;
      if (!via || !target) {
        note(
          'approximated',
          `"${c.via}" is not a reference to another feature type; the clause evaluates to false`,
        );
        return 'false';
      }
      const at = `${env.base}.${via.key}`;
      if (via.type !== 'reference') return 'false';
      const q = c.quantifier ?? 'any';
      if (via.relation !== undefined) {
        // a many-valued relation: a list of features, read with the macros
        const depth = /^r(\d+)$/.exec(env.base);
        const v = `r${depth ? Number(depth[1]) + 1 : 1}`;
        const inner = c.condition
          ? translate(c.condition, { ...env, type: target, base: v, form: new Set<string>() }, note)
          : 'true';
        if (!c.condition) return q === 'none' ? `size(${at}) == 0` : q === 'all' ? 'true' : `size(${at}) > 0`;
        if (q === 'none') return `!${at}.exists(${v}, ${inner})`;
        return `${at}.${q === 'all' ? 'all' : 'exists'}(${v}, ${inner})`;
      }
      const inner = c.condition
        ? translate(c.condition, { ...env, type: target, base: at, form: new Set<string>() }, note)
        : 'true';
      if (q === 'none') return c.condition ? `(${at} == null || !(${inner}))` : `${at} == null`;
      if (q === 'all') return c.condition ? `(${at} == null || ${wrap(inner)})` : 'true';
      return c.condition ? `(${at} != null && ${wrap(inner)})` : `${at} != null`;
    }
    case 'unknown':
      note('dropped', `${c.label} is not known; the clause evaluates to false`);
      return 'false';
  }
}
