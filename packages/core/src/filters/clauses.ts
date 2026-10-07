/**
 * The rows of the view builder and how they are written (WP-665, v3 `FilterBuilder` + `authored.ts`). A saved view is
 * `{ <Objektart>: <rule-language source> }` (`FilterSource`); a row becomes one term of that source and the terms of one
 * Objektart are joined with AND, as v3 did. Field and stage rows apply to their Objektart only; the "when" and
 * "created by" rows apply to every Objektart the builder offers (v3 `scopeWf`). An empty row writes nothing, so a
 * half-built view still shows data. `filterTerm` (`./fields`) is the one writer of a term (R1); the reader of the
 * result is `core.expr` through `applyFilter`.
 */
import type { Json } from '../model';
import type { PropertyTypeKey } from '../registry';
import {
  FILTER_CREATED_BY_SYSTEM,
  FILTER_WHEN_SYSTEM,
  type FilterPresence,
  type FilterWhenField,
  type FilterWhenMode,
} from '../registry/filter';
import type { FilterSource } from './contract';
import { filterTerm, joinTerms } from './fields';

interface FieldRow {
  readonly kind: 'field';
  readonly type: string;
  readonly key: string;
  readonly propType: PropertyTypeKey;
}
export interface TextClause extends FieldRow {
  readonly editor: 'text';
  readonly text: string;
}
export interface NumberClause extends FieldRow {
  readonly editor: 'number';
  readonly min: number | null;
  readonly max: number | null;
}
export interface DateClause extends FieldRow {
  readonly editor: 'date';
  /** `YYYY-MM-DD` or null (open). */
  readonly from: string | null;
  readonly to: string | null;
}
export interface ChoiceClause extends FieldRow {
  readonly editor: 'choice';
  readonly values: readonly string[];
}
export interface BooleanClause extends FieldRow {
  readonly editor: 'boolean';
  /** Yes, no, or null (open). */
  readonly value: boolean | null;
}
export interface TimeClause extends FieldRow {
  readonly editor: 'time';
  /** `HH:MM` or null (open). */
  readonly from: string | null;
  readonly to: string | null;
}
export interface ParticipantClause extends FieldRow {
  readonly editor: 'participant';
  /** "ich": the property is the signed-in person. */
  readonly me: boolean;
}
export interface PresenceClause extends FieldRow {
  readonly editor: 'presence';
  /** No value, any value, or null (open). */
  readonly state: FilterPresence | null;
}
export interface StageClause {
  readonly kind: 'stage';
  readonly type: string;
  readonly values: readonly string[];
}
export interface WhenClause {
  readonly kind: 'when';
  readonly field: FilterWhenField;
  readonly mode: FilterWhenMode;
  readonly days: number;
  readonly from: string | null;
  readonly to: string | null;
}
export interface CreatedByClause {
  readonly kind: 'created_by';
  readonly values: readonly string[];
}
/** A term the builder has no row for: kept as written and written back unchanged. */
export interface RuleClause {
  readonly kind: 'rule';
  readonly type: string;
  readonly source: string;
}

export type FieldClause =
  | TextClause
  | NumberClause
  | DateClause
  | ChoiceClause
  | BooleanClause
  | TimeClause
  | ParticipantClause
  | PresenceClause;
export type Clause = FieldClause | StageClause | WhenClause | CreatedByClause | RuleClause;

const DAY_MS = 86_400_000;

/** The day after `YYYY-MM-DD` (calendar arithmetic only, no clock). */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}
/** The day before `YYYY-MM-DD`. */
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

const blank = (v: string | null): boolean => v === null || v.trim() === '';
const isDay = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * A range of days on `self.<key>`. A `date` property compares the day itself; a timestamp includes the whole last
 * day (`< day + 1`), better than v3, which compared at midnight and so dropped the last day.
 */
export function dayRangeTerm(
  field: { readonly key: string; readonly type: PropertyTypeKey },
  from: string | null,
  to: string | null,
): string | null {
  const f = blank(from) || !isDay(from as string) ? null : (from as string);
  const t = blank(to) || !isDay(to as string) ? null : (to as string);
  if (field.type === 'date') return filterTerm(field, 'between', [f, t]);
  const self = `self.${field.key}`;
  const parts = [
    f === null ? null : `${self} >= date(${JSON.stringify(f)})`,
    t === null ? null : `${self} < date(${JSON.stringify(nextDay(t))})`,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : parts.join(' && ');
}

/** `HH:MM`, the one spelling of a `time` value; anything else is an open end. */
export const isTimeOfDay = (v: string | null): v is string =>
  v !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const SYSTEM_TIME = { type: 'datetime' } as const;

function whenTerm(c: WhenClause): string | null {
  const field = { key: FILTER_WHEN_SYSTEM[c.field], ...SYSTEM_TIME };
  if (c.mode === 'between') return dayRangeTerm(field, c.from, c.to);
  if (!Number.isFinite(c.days) || c.days <= 0) return null;
  return filterTerm(field, c.mode === 'older' ? 'older_than_days' : 'newer_than_days', c.days);
}

/** One row as a term of rule-language source over `self`; null when the row is empty. */
export function clauseTerm(c: Clause): string | null {
  switch (c.kind) {
    case 'field': {
      const f = { key: c.key, type: c.propType };
      switch (c.editor) {
        case 'text':
          return filterTerm(f, 'contains', c.text);
        case 'number':
          return filterTerm(f, 'between', [c.min, c.max] as Json);
        case 'date':
          return dayRangeTerm(f, c.from, c.to);
        case 'choice':
          return filterTerm(f, 'in', [...c.values]);
        case 'boolean':
          return c.value === null ? null : filterTerm(f, 'eq', c.value);
        case 'time':
          return filterTerm(f, 'between', [
            isTimeOfDay(c.from) ? c.from : null,
            isTimeOfDay(c.to) ? c.to : null,
          ]);
        case 'participant':
          return c.me ? filterTerm(f, 'is_me') : null;
        case 'presence':
          return c.state === null ? null : filterTerm(f, c.state === 'empty' ? 'is_empty' : 'is_not_empty');
      }
      return null;
    }
    case 'stage':
      return null;
    case 'when':
      return whenTerm(c);
    case 'created_by':
      return filterTerm({ key: FILTER_CREATED_BY_SYSTEM, type: 'text' }, 'in', [...c.values]);
    case 'rule':
      return c.source;
  }
}

/**
 * The saved view of these rows: per Objektart one source. `types` are the Objektarten the "when" and "created by"
 * rows apply to; a type without any term gets no entry (it is not restricted).
 */
export function clausesToFilter(
  clauses: readonly Clause[],
  types: readonly string[],
  stageProperty: (type: string) => string | undefined,
): FilterSource {
  // The terms are joined with AND, so their order does not change what passes; the evaluator stops at the first
  // false one, so the terms that need timestamp arithmetic go last (core parses a timestamp on every comparison).
  const cheap = new Map<string, (string | null)[]>();
  const dear = new Map<string, (string | null)[]>();
  const add = (type: string, term: string | null, costly: boolean): void => {
    const into = costly ? dear : cheap;
    const list = into.get(type) ?? [];
    list.push(term);
    into.set(type, list);
  };
  for (const c of clauses) {
    if (c.kind === 'when' || c.kind === 'created_by') {
      const term = clauseTerm(c);
      for (const t of types) add(t, term, c.kind === 'when');
    } else if (c.kind === 'stage') {
      const key = stageProperty(c.type);
      add(c.type, key === undefined ? null : filterTerm({ key, type: 'select' }, 'in', [...c.values]), false);
    } else add(c.type, clauseTerm(c), c.kind === 'field' && c.editor === 'date');
  }
  const out: Record<string, string> = {};
  for (const type of new Set([...cheap.keys(), ...dear.keys()])) {
    const source = joinTerms([...(cheap.get(type) ?? []), ...(dear.get(type) ?? [])]);
    if (source !== null) out[type] = source;
  }
  return out;
}
