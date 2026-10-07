/** The rows, config and encoder the view-builder specs share (WP-665). */
import type { Clause } from '../clauses';
import { clausesToFilter } from '../clauses';
import { builderContext } from '../builder-context';
import { actorOf, viewsWorld } from './views-world';

export const config = viewsWorld();
export const kontrolle = actorOf(['kontrolle']);
export const ctx = builderContext(config, kontrolle, 'de');
export const stageOf = (t: string): string | undefined => ctx.stages.find((s) => s.type === t)?.property;
export const encode = (cs: readonly Clause[]) => clausesToFilter(cs, ctx.types, stageOf);

export const baum = { kind: 'field' as const, type: 'baum' };
export const text = (v: string): Clause => ({
  ...baum,
  key: 'name',
  propType: 'text',
  editor: 'text',
  text: v,
});
export const num = (min: number | null, max: number | null): Clause => ({
  ...baum,
  key: 'hoehe',
  propType: 'number',
  editor: 'number',
  min,
  max,
});
export const day = (from: string | null, to: string | null): Clause => ({
  ...baum,
  key: 'pflanzdatum',
  propType: 'date',
  editor: 'date',
  from,
  to,
});
export const dayTime = (from: string | null, to: string | null): Clause => ({
  ...baum,
  key: 'kontrolliert',
  propType: 'datetime',
  editor: 'date',
  from,
  to,
});
export const choice = (key: string, propType: 'select' | 'multiselect', values: string[]): Clause => ({
  ...baum,
  key,
  propType,
  editor: 'choice',
  values,
});
export const stage = (values: string[]): Clause => ({ kind: 'stage', type: 'baum', values });
export const when = (
  field: 'created' | 'changed',
  mode: 'older' | 'newer' | 'between',
  days = 7,
  from: string | null = null,
  to: string | null = null,
): Clause => ({ kind: 'when', field, mode, days, from, to });
export const by = (values: string[]): Clause => ({ kind: 'created_by', values });
